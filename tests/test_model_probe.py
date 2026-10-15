import asyncio
import json
import unittest

import httpx

from app import extract_models, normalize_base_url, probe_model_access


def mock_client(status_code, body):
    def handler(request):
        content = json.dumps(body).encode("utf-8") if isinstance(body, dict) else body.encode("utf-8")
        return httpx.Response(status_code, content=content, request=request)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class ModelProbeTests(unittest.TestCase):
    def test_normalizes_markdown_link_copied_from_chat(self):
        value = "[https://example.test/compatible-mode/v1](https://example.test/compatible-mode/v1)"
        self.assertEqual(
            normalize_base_url(value),
            "https://example.test/compatible-mode/v1",
        )

    def test_extracts_common_provider_model_shapes(self):
        self.assertEqual(
            extract_models({"data": [{"id": "gpt-x"}, {"id": "deepseek-y"}]}),
            ["gpt-x", "deepseek-y"],
        )
        self.assertEqual(
            extract_models({"models": ["qwen-z", {"name": "claude-a"}]}),
            ["qwen-z", "claude-a"],
        )

    def test_success_means_request_accepted_and_lists_any_model_family(self):
        async def run():
            async with mock_client(200, {"data": [{"id": "deepseek-v4-pro"}, {"id": "qwen-plus"}]}) as client:
                return await probe_model_access(
                    {"base_url": "https://example.test/v1", "api_key": "test-key"},
                    client,
                )

        result = asyncio.run(run())
        self.assertTrue(result["ok"])
        self.assertEqual(result["auth_status"], "accepted")
        self.assertEqual(result["http_status"], 200)
        self.assertEqual(result["models"], ["deepseek-v4-pro", "qwen-plus"])
        self.assertEqual(result["request_url"], "https://example.test/v1/models")

    def test_unauthorized_preserves_upstream_status_and_message(self):
        async def run():
            async with mock_client(401, {"error": {"message": "invalid api key"}}) as client:
                return await probe_model_access(
                    {"base_url": "https://example.test/v1", "api_key": "bad-key"},
                    client,
                )

        result = asyncio.run(run())
        self.assertFalse(result["ok"])
        self.assertEqual(result["auth_status"], "rejected")
        self.assertEqual(result["http_status"], 401)
        self.assertEqual(result["error"], "invalid api key")

    def test_missing_models_route_does_not_claim_key_is_invalid(self):
        async def run():
            async with mock_client(404, {"message": "not found"}) as client:
                return await probe_model_access(
                    {"base_url": "https://example.test/v1", "api_key": "test-key"},
                    client,
                )

        result = asyncio.run(run())
        self.assertFalse(result["ok"])
        self.assertEqual(result["auth_status"], "unknown")
        self.assertEqual(result["http_status"], 404)
        self.assertEqual(result["error"], "not found")


if __name__ == "__main__":
    unittest.main()
