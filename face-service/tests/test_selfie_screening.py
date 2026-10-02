import unittest
from unittest.mock import AsyncMock, patch

import numpy as np

import main


def face(x=25, y=25, w=50, h=50, confidence=0.95):
    return {
        "facial_area": {"x": x, "y": y, "w": w, "h": h},
        "confidence": confidence,
    }


def best_face(face_count=1, confidence=0.95):
    boxes = [{"x": 25, "y": 25, "w": 50, "h": 50}]
    if face_count > 1:
        boxes.append({"x": 60, "y": 20, "w": 30, "h": 30})
    return {
        "bbox": boxes[0],
        "confidence": confidence,
        "face_count": face_count,
        "faces": boxes,
    }


def contrast_frame():
    gray = ((np.indices((100, 100)).sum(axis=0) % 2) * 100 + 80).astype(np.uint8)
    return np.repeat(gray[:, :, None], 3, axis=2)


class SelfieScreeningTests(unittest.TestCase):
    def setUp(self):
        self.frame = np.full((100, 100, 3), 128, dtype=np.uint8)
        self.messages = {
            "multi_face_message": "Multiple faces",
            "small_face_message": "Too small",
            "large_face_message": "Too close",
            "low_conf_message": "Low confidence",
            "use_secondary_count": False,
        }

    def test_whole_frame_placeholder_falls_back_to_real_detector(self):
        placeholder = face(x=0, y=0, w=99, h=99, confidence=0)
        with patch.object(main.DeepFace, "extract_faces", side_effect=[[placeholder], [face()]]) as detect:
            result = main.extract_best_face(self.frame)

        self.assertEqual(result["bbox"], {"x": 25, "y": 25, "w": 50, "h": 50})
        self.assertEqual([call.kwargs["detector_backend"] for call in detect.call_args_list], ["opencv", "ssd"])
        self.assertTrue(all(call.kwargs["enforce_detection"] for call in detect.call_args_list))

    def test_missing_face_never_becomes_too_close(self):
        with patch.object(main.DeepFace, "extract_faces", side_effect=ValueError("No face")):
            with self.assertRaisesRegex(ValueError, "couldn't find a face"):
                main.extract_best_face(self.frame)

        with patch.object(main, "extract_best_face", side_effect=ValueError("No face")):
            _, best, error = main.select_selfie_frame(np.full_like(self.frame, 255), **self.messages)
        self.assertIsNone(best)
        self.assertIn("glare", error)
        self.assertNotIn("close", error.lower())

    def test_low_confidence_is_not_reported_as_too_close(self):
        oversized = best_face(confidence=0)
        oversized["bbox"] = {"x": 0, "y": 0, "w": 99, "h": 99}
        result = main.validate_face_constraints(
            oversized, self.frame,
            min_ratio=main.MIN_FACE_AREA_RATIO,
            max_ratio=main.MAX_FACE_AREA_RATIO,
            min_confidence=main.MIN_FACE_CONFIDENCE,
            **self.messages,
        )
        self.assertEqual(result, "Low confidence")

        oversized["confidence"] = 0.95
        result = main.validate_face_constraints(
            oversized, self.frame,
            min_ratio=main.MIN_FACE_AREA_RATIO,
            max_ratio=main.MAX_FACE_AREA_RATIO,
            min_confidence=main.MIN_FACE_CONFIDENCE,
            **self.messages,
        )
        self.assertEqual(result, "Too close")

    def test_recoverable_dark_and_bright_frames_use_normalized_face(self):
        normalized = contrast_frame()
        for brightness in (5, 250):
            with self.subTest(brightness=brightness):
                frame = np.full_like(self.frame, brightness)
                with patch.object(main, "normalize_image", return_value=normalized), \
                     patch.object(main, "extract_best_face", side_effect=[ValueError("No face"), best_face()]):
                    selected, best, error = main.select_selfie_frame(frame, **self.messages)
                self.assertIs(selected, normalized)
                self.assertEqual(best["face_count"], 1)
                self.assertIsNone(error)

    def test_visible_face_detail_is_checked_instead_of_average_brightness(self):
        checker = np.indices((50, 50)).sum(axis=0) % 2
        for low, high in ((1, 21), (238, 255)):
            with self.subTest(low=low, high=high):
                frame = np.full_like(self.frame, low)
                face_pixels = (checker * (high - low) + low).astype(np.uint8)
                frame[25:75, 25:75] = face_pixels[:, :, None]
                self.assertIsNone(main.check_image_quality(frame, best_face()["bbox"]))

    def test_multiple_faces_remain_blocked(self):
        with patch.object(main, "extract_best_face", return_value=best_face(face_count=2)):
            _, _, error = main.select_selfie_frame(self.frame, **self.messages)
        self.assertEqual(error, "Multiple faces")

    def test_embeddings_require_a_detected_face(self):
        with patch.object(main.DeepFace, "represent", return_value=[{"embedding": [1.0, 0.0]}]) as represent:
            embedding = main.get_embedding_fast(self.frame)
        np.testing.assert_array_equal(embedding, np.array([1.0, 0.0], dtype=np.float32))
        self.assertTrue(represent.call_args.kwargs["enforce_detection"])


class SelfieApprovalTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovered_lighting_still_needs_and_can_pass_an_id_match(self):
        frame = np.full((100, 100, 3), 5, dtype=np.uint8)
        normalized = contrast_frame()
        record = {"id_embedding": [1.0, 0.0], "role": "user", "full_name": "Test User"}
        collection = type("FakeCollection", (), {})()
        collection.find_one = AsyncMock(return_value=record)
        collection.update_one = AsyncMock()
        collection.delete_one = AsyncMock()
        request = main.KycSelfieVerifyRequest(user_id="pre:test-session", selfie_image_base64="fixture")

        with patch.object(main, "kyc_col", collection), \
             patch.object(main, "decode_base64_image", return_value=frame), \
             patch.object(main, "normalize_image", return_value=normalized), \
             patch.object(main, "extract_best_face", side_effect=[ValueError("No face"), best_face()]), \
             patch.object(main, "get_embedding_fast", return_value=np.array([1.0, 0.0], dtype=np.float32)) as embedding:
            result = await main.post_kyc_selfie_verify(request)

        self.assertTrue(result.verified)
        self.assertIs(embedding.call_args.args[0], normalized)
        collection.delete_one.assert_awaited_once()

    async def test_id_match_is_still_required(self):
        frame = np.full((100, 100, 3), 128, dtype=np.uint8)
        record = {"id_embedding": [1.0, 0.0], "role": "user", "full_name": "Test User"}
        collection = type("FakeCollection", (), {})()
        collection.find_one = AsyncMock(return_value=record)
        collection.update_one = AsyncMock()
        collection.delete_one = AsyncMock()
        request = main.KycSelfieVerifyRequest(user_id="pre:test-session", selfie_image_base64="fixture")

        with patch.object(main, "kyc_col", collection), \
             patch.object(main, "decode_base64_image", return_value=frame), \
             patch.object(main, "select_selfie_frame", return_value=(frame, best_face(), None)), \
             patch.object(main, "get_embedding_fast", return_value=np.array([0.0, 1.0], dtype=np.float32)):
            result = await main.post_kyc_selfie_verify(request)

        self.assertFalse(result.verified)
        collection.delete_one.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
