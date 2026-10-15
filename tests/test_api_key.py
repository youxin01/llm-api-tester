import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import app as tester


class ApiKeyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file_patch = patch.object(
            tester, "ENDPOINTS_FILE", Path(self.directory.name) / "endpoints.json"
        )
        self.file_patch.start()
        self.addCleanup(self.file_patch.stop)
        self.client = TestClient(tester.app)
        self.addCleanup(self.client.close)
        response = self.client.post("/api/endpoints", json={
            "name": "Key test", "base_url": "https://example.test/v1",
            "api_key": "sk-test-original", "model": "test-model",
        })
        self.assertEqual(response.status_code, 200)
        self.endpoint_id = response.json()["id"]

    def test_key_can_be_read_explicitly_but_stays_masked_in_list(self):
        endpoint = self.client.get("/api/endpoints").json()[0]
        self.assertNotIn("api_key", endpoint)
        response = self.client.get(f"/api/endpoints/{self.endpoint_id}/api-key")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"api_key": "sk-test-original"})
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_replacement_is_saved_and_blank_still_keeps_existing_key(self):
        url = f"/api/endpoints/{self.endpoint_id}"
        response = self.client.put(url, json={"api_key": "sk-test-replacement"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("api_key", response.json())
        self.client.put(url, json={"api_key": ""})
        self.assertEqual(
            self.client.get(f"{url}/api-key").json()["api_key"],
            "sk-test-replacement",
        )

    def test_empty_key_and_missing_endpoint(self):
        url = f"/api/endpoints/{self.endpoint_id}"
        self.client.put(url, json={"api_key": "__CLEAR__"})
        self.assertEqual(self.client.get(f"{url}/api-key").json(), {"api_key": ""})
        self.assertEqual(self.client.get("/api/endpoints/missing/api-key").status_code, 404)

    def test_ui_responses_do_not_reuse_cached_pages_or_scripts(self):
        for url in ("/", "/static/app.js", "/static/app.js?v=20261012-key-feedback",
                    "/static/style.css?v=20261012-key-feedback"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
