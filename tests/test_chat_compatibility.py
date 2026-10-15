import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

import app


ENDPOINT = {"id": "demo", "name": "Demo", "base_url": "https://example.test/v1", "model": "LongCat-2.5-Preview"}


class Chunks(httpx.AsyncByteStream):
    def __init__(self, data, error=None):
        self.data = data
        self.error = error

    async def __aiter__(self):
        # Split within UTF-8/JSON boundaries to exercise HTTPX's incremental decoding.
        for index in range(0, len(self.data), 17):
            yield self.data[index:index + 17]
        if self.error:
            raise self.error


def event(data):
    return "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"


class ChatCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def stream_result(self, wire, error=None):
        sent = []

        def handler(request):
            sent.append(json.loads(request.content))
            return httpx.Response(200, headers={"content-type": "text/event-stream; charset=utf-8"},
                                  stream=Chunks(wire.encode("utf-8"), error))

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await app.test_one(ENDPOINT, "Reply OK", None, None, "none", client=client)
        return result, sent

    async def test_longcat_stream_switch_and_blank_parameters(self):
        body = app.build_chat_body(ENDPOINT, "task", None, None, "none")
        self.assertTrue(body["stream"])
        self.assertEqual(body["thinking"], {"type": "disabled"})
        self.assertNotIn("reasoning_effort", body)
        self.assertNotIn("temperature", body)
        self.assertNotIn("max_tokens", body)
        self.assertFalse(app.build_chat_body(ENDPOINT, "task", None, None, "", False)["stream"])

    async def test_switch_only_does_not_silently_map_effort_to_on(self):
        with self.assertRaisesRegex(ValueError, "only on/off"):
            app.build_chat_body(ENDPOINT, "task", None, None, "high")

    async def test_known_glm_options_match_live_error_and_valid_requests(self):
        ep = {**ENDPOINT, "model": "ZHIPU/GLM-5.3-Flash"}
        self.assertNotIn("none", app.generation_capabilities(ep)["allowed_efforts"])
        self.assertEqual(app.build_chat_body(ep, "task", None, None, "high")["reasoning_effort"], "high")
        self.assertNotIn("reasoning_effort", app.build_chat_body(ep, "task", None, None, "enabled"))
        with self.assertRaisesRegex(ValueError, "requires thinking"):
            app.build_chat_body(ep, "task", None, None, "none")

    async def test_standard_effort_token_field_and_explicit_override(self):
        ep = {**ENDPOINT, "model": "gpt-5.6-sol"}
        body = app.build_chat_body(ep, "task", None, 1000000, "low")
        self.assertEqual(body["max_completion_tokens"], 1000000)
        self.assertEqual(body["reasoning_effort"], "low")
        self.assertFalse(body["stream"])
        ep["token_parameter"] = "max_tokens"
        self.assertEqual(app.build_chat_body(ep, "task", None, 99, "")["max_tokens"], 99)
        qwen = {**ENDPOINT, "model": "qwen-plus"}
        self.assertFalse(app.build_chat_body(qwen, "task", None, None, "none")["enable_thinking"])

    async def test_sse_assembles_content_reasoning_usage_and_done(self):
        wire = ": heartbeat\n\n" + event({"model": ENDPOINT["model"], "choices": [{"index": 0, "delta": {"reasoning_content": "想一想"}}]})
        wire += event({"choices": [{"index": 0, "delta": {"content": "<svg>"}}]})
        wire += event({"choices": [{"index": 0, "delta": {"content": "鹈鹕</svg>"}, "finish_reason": "stop"}]})
        wire += event({"choices": [], "usage": {"completion_tokens": 20}}) + "data: [DONE]\n\n"
        result, sent = await self.stream_result(wire)
        self.assertTrue(result["ok"])
        self.assertEqual(result["content"], "<svg>鹈鹕</svg>")
        self.assertEqual(result["reasoning_content"], "想一想")
        self.assertEqual(result["usage"]["completion_tokens"], 20)
        self.assertTrue(result["stream_complete"])
        self.assertTrue(result["model_match"])
        self.assertEqual(result["response_format"], "sse")
        self.assertIsNotNone(result["first_event_ms"])
        self.assertEqual(len(sent), 1)

    async def test_finish_marker_without_done_is_accepted(self):
        result, _ = await self.stream_result(event({"choices": [{"delta": {"content": "OK"}, "finish_reason": "stop"}]}))
        self.assertTrue(result["ok"])

    async def test_unterminated_stream_is_not_success_and_keeps_partial_text(self):
        result, _ = await self.stream_result(event({"choices": [{"delta": {"content": "<html>partial"}}]}))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_code"], "stream_incomplete")
        self.assertEqual(result["content"], "<html>partial")
        self.assertEqual(result["http_status"], 200)

    async def test_mid_stream_disconnect_keeps_content_and_never_retries(self):
        wire = event({"choices": [{"delta": {"content": "<svg>partial"}}]})
        result, sent = await self.stream_result(wire, httpx.RemoteProtocolError("Server disconnected"))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_code"], "upstream_disconnected")
        self.assertEqual(result["content"], "<svg>partial")
        self.assertEqual(len(sent), 1)

    async def test_stream_error_event_is_preserved(self):
        result, _ = await self.stream_result(event({"error": {"message": "quota exhausted"}}))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_code"], "upstream_stream_error")
        self.assertEqual(result["error"], "quota exhausted")

    async def test_invalid_sse_is_not_silently_ignored(self):
        result, _ = await self.stream_result("data: not-json\n\n")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_code"], "invalid_response")

    async def test_json_fallback_and_reasoning_only_classification(self):
        def handler(request):
            return httpx.Response(200, json={"model": ENDPOINT["model"], "choices": [{"message": {
                "content": None, "reasoning_content": "thinking"}, "finish_reason": "length"}],
                "usage": {"completion_tokens": 200, "completion_tokens_details": {"reasoning_tokens": 199}}})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await app.test_one(ENDPOINT, "task", None, 200, "", client=client)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_code"], "output_limit")
        self.assertEqual(result["reasoning_content"], "thinking")
        self.assertEqual(result["response_format"], "json")

    async def test_pre_header_disconnect_has_no_false_http_status(self):
        def handler(request):
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await app.test_one(ENDPOINT, "task", None, None, "", client=client)
        self.assertIsNone(result["http_status"])
        self.assertEqual(result["error_code"], "upstream_disconnected")

    async def test_unsupported_setting_fails_before_any_upstream_call(self):
        def handler(request):
            self.fail("Unsupported setting must not call the provider")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await app.test_one(ENDPOINT, "task", None, None, "high", client=client)
        self.assertEqual(result["error_code"], "unsupported_setting")
        self.assertIsNone(result["http_status"])


class RouteCompositionTests(unittest.TestCase):
    def test_both_routes_forward_the_same_optional_parameters(self):
        runner = AsyncMock(return_value={"ok": True})
        payload = {"prompt": "OK", "reasoning_effort": "none", "stream": True, "max_tokens": 500, "timeout_seconds": 60}
        with patch.object(app, "load_endpoints", return_value=[ENDPOINT]), \
             patch.object(app, "test_one", runner), patch.object(app, "append_history"):
            with TestClient(app.app) as client:
                self.assertEqual(client.post("/api/test/demo", json=payload).status_code, 200)
                self.assertEqual(client.post("/api/test-all", json=payload).status_code, 200)
        self.assertEqual(runner.await_count, 2)
        for call in runner.await_args_list:
            self.assertEqual(call.args, (ENDPOINT, "OK", None, 500, "none", 60, True))

    def test_stream_setting_can_be_reset_to_auto_without_erasing_a_key(self):
        record = {**ENDPOINT, "stream": True, "api_key": "fake-key"}
        with patch.object(app, "load_endpoints", return_value=[record]), patch.object(app, "save_endpoints") as save:
            with TestClient(app.app) as client:
                response = client.put("/api/endpoints/demo", json={"stream": None, "api_key": ""})
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(save.call_args.args[0][0]["stream"])
            self.assertEqual(save.call_args.args[0][0]["api_key"], "fake-key")


if __name__ == "__main__":
    unittest.main()
