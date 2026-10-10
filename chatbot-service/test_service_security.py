import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import app


KEY = "chatbot-python-fixture-service-key-32-characters"


class ChatbotServiceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"INTERNAL_API_KEY": KEY, "CHATBOT_INTERNAL_API_KEY": ""})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.classifier = patch("app.classify_message", return_value={"intent": "payment_methods", "language": "en"})
        self.inference = self.classifier.start()
        self.addCleanup(self.classifier.stop)

    def test_missing_wrong_duplicate_and_non_ascii_keys_do_not_reach_classification(self):
        for headers in [{}, {"x-internal-key": "wrong"},
                        [("x-internal-key", KEY), ("x-internal-key", "wrong")],
                        {"x-internal-key": b"\xffinvalid"}]:
            response = self.client.post("/chat", headers=headers, json={"message": "payment methods"})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn(KEY, response.text)
        self.inference.assert_not_called()

    def test_authentication_precedes_request_body_validation(self):
        response = self.client.post("/chat", content="{invalid", headers={"content-type": "application/json"})
        self.assertEqual(response.status_code, 403)
        self.inference.assert_not_called()

    def test_matching_key_preserves_chat_and_validation(self):
        response = self.client.post("/chat", headers={"x-internal-key": KEY}, json={"message": "payment methods"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["intent"], "payment_methods")
        self.inference.assert_called_once()
        invalid = self.client.post("/chat", headers={"x-internal-key": KEY}, content="{invalid")
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(self.inference.call_count, 1)

    def test_missing_or_weak_configuration_fails_closed(self):
        for key in ["", "short-key"]:
            os.environ["INTERNAL_API_KEY"] = key
            response = self.client.post("/chat", headers={"x-internal-key": KEY}, json={"message": "payment methods"})
            self.assertEqual(response.status_code, 503)
        self.inference.assert_not_called()

    def test_dedicated_key_takes_precedence_without_changing_other_service_credentials(self):
        dedicated = f"dedicated-{KEY}"
        os.environ["CHATBOT_INTERNAL_API_KEY"] = dedicated
        self.assertEqual(self.client.post("/chat", headers={"x-internal-key": KEY}, json={"message": "payment methods"}).status_code, 403)
        self.assertEqual(self.client.post("/chat", headers={"x-internal-key": dedicated}, json={"message": "payment methods"}).status_code, 200)
        self.assertEqual(os.environ["INTERNAL_API_KEY"], KEY)

    def test_health_is_public_but_metadata_and_docs_require_service_authentication(self):
        os.environ["INTERNAL_API_KEY"] = ""
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
        self.assertEqual(self.client.head("/health").status_code, 200)
        os.environ["INTERNAL_API_KEY"] = KEY
        for path in ["/", "/docs", "/openapi.json"]:
            self.assertEqual(self.client.get(path).status_code, 403)
            self.assertEqual(self.client.get(path, headers={"x-internal-key": KEY}).status_code, 200)
        self.assertEqual(self.client.post("/health").status_code, 403)


if __name__ == "__main__":
    unittest.main()
