import asyncio
import base64
import io
import os
import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
from fastapi.testclient import TestClient
from PIL import Image


class FakeEngine:
    def predict(self, image):
        return [{"rec_texts": ["SYNTHETIC SAMPLE"], "rec_scores": [0.9], "rec_boxes": [[10, 10, 180, 40]]}]


def image_bytes(format="PNG"):
    out = io.BytesIO()
    Image.new("RGB", (400, 100), "white").save(out, format=format)
    return out.getvalue()


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"INTERNAL_API_KEY": "i" * 32})
        self.env.start()
        main.ENGINE = FakeEngine()
        main.ACTIVE = asyncio.Lock()
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        self.client.close()
        main.ENGINE = None
        self.env.stop()

    def request(self, **updates):
        body = {"schema_version": 1, "base64": base64.b64encode(image_bytes()).decode(), "mime_type": "image/png"}
        body.update(updates)
        return self.client.post("/inspect", json=body, headers={"x-internal-key": "i" * 32})

    def test_authenticated_extraction_has_no_store_and_no_decisions(self):
        response = self.request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        self.assertEqual(set(response.json()), {"schema_version", "provider", "pages", "lines", "layout_version"})
        self.assertEqual(response.json()["lines"][0]["bbox"], [0.025, 0.1, 0.45, 0.4])
        self.assertEqual(response.json()["layout_version"], 2)

    def test_authentication_precedes_processing(self):
        self.assertEqual(self.client.post("/inspect", content=b"invalid").status_code, 401)
        self.assertEqual(self.client.post("/inspect", content=b"invalid", headers={"x-internal-key": "wrong"}).status_code, 401)

    def test_health_advertises_text_position_capability_without_personal_data(self):
        for ready in [True, False]:
            main.ENGINE = FakeEngine() if ready else None
            response = self.client.get("/health")
            self.assertEqual(response.status_code, 200 if ready else 503)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.json(), {"ready": ready, "schema_version": 1,
                                               "provider": "paddleocr", "layout_version": 2})

    def test_unsupported_schema_encoding_and_media(self):
        for changes in [{"schema_version": 2}, {"schema_version": True}, {"base64": "invalid!"}, {"mime_type": "text/plain"}, {"mime_type": {}}, {"profile": {"name": "sample"}}, {"base64": ""}]:
            with self.subTest(changes=changes):
                self.assertEqual(self.request(**changes).status_code, 422)

    def test_mime_signature_mismatch_and_large_files(self):
        self.assertEqual(self.request(mime_type="image/jpeg").status_code, 422)
        self.assertEqual(self.request(base64=base64.b64encode(b"a" * (main.MAX_FILE_BYTES + 1)).decode()).status_code, 422)
        response = self.client.post("/inspect", content=b"a" * (main.MAX_REQUEST_BYTES + 1), headers={"x-internal-key": "i" * 32})
        self.assertEqual(response.status_code, 413)

    def test_unreadable_image_and_pdf(self):
        self.assertEqual(self.request(base64=base64.b64encode(b"invalid image").decode()).status_code, 422)
        self.assertEqual(self.request(base64=base64.b64encode(b"%PDF-invalid").decode(), mime_type="application/pdf").status_code, 422)

    def test_busy_and_startup_are_retryable(self):
        asyncio.run(main.ACTIVE.acquire())
        self.assertEqual(self.request().status_code, 429)
        main.ACTIVE.release()
        main.ENGINE = None
        self.assertEqual(self.request().status_code, 503)
        self.assertEqual(self.client.get("/health").status_code, 503)

    def test_pdf_pages_are_bounded_and_original_bytes_remain_in_memory(self):
        out = io.BytesIO()
        Image.new("RGB", (400, 200), "white").save(out, format="PDF", save_all=True)
        self.assertEqual(self.request(base64=base64.b64encode(out.getvalue()).decode(), mime_type="application/pdf").status_code, 200)
        self.assertEqual(len(list(main.image_frames(image_bytes(), "image/png"))), 1)
        output = io.BytesIO()
        pages = [Image.new("RGB", (400, 200), "white") for _ in range(6)]
        pages[0].save(output, format="PDF", save_all=True, append_images=pages[1:])
        self.assertEqual(self.request(base64=base64.b64encode(output.getvalue()).decode(), mime_type="application/pdf").status_code, 422)

    def test_invalid_and_oversized_ocr_output_does_not_leave_the_service(self):
        for result in [{"rec_texts": ["sample"], "rec_scores": []},
                       {"rec_texts": ["sample"], "rec_scores": [float("nan")]},
                       {"rec_texts": ["sample"] * 1201, "rec_scores": [0.9] * 1201}]:
            with patch.object(main.ENGINE, "predict", return_value=[result]):
                response = self.request()
                self.assertIn(response.status_code, [422, 503])
                self.assertNotIn("sample", response.text)

    def test_startup_requires_authentication_before_loading_models(self):
        with patch.dict(os.environ, {"INTERNAL_API_KEY": "short"}), patch.object(main, "create_engine") as create:
            with self.assertRaisesRegex(RuntimeError, "INTERNAL_API_KEY"):
                with TestClient(main.app):
                    pass
            create.assert_not_called()

    def test_positions_are_bounded_and_match_the_recognized_text(self):
        for boxes in [[], [[0, 0, 500, 40]], [[0, 0, float("nan"), 40]], [[50, 10, 20, 40]]]:
            with patch.object(main.ENGINE, "predict", return_value=[{
                    "rec_texts": ["SYNTHETIC SAMPLE"], "rec_scores": [0.95], "rec_boxes": boxes}]):
                self.assertEqual(self.request().status_code, 503)


if __name__ == "__main__":
    unittest.main()
