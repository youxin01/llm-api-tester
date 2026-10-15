from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
ENDPOINTS_FILE = DATA_DIR / "endpoints.json"
HISTORY_FILE = DATA_DIR / "history.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="LLM API Endpoint Tester", version="1.0.0")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def refresh_local_ui(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def mask_key(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:3]}{'*' * max(5, len(value)-7)}{value[-4:]}"


def normalize_base_url(url: str) -> str:
    value = url.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1].strip()
    markdown_link = re.fullmatch(r"\[[^\]]+\]\((https?://[^)]+)\)", value, re.IGNORECASE)
    if markdown_link:
        value = markdown_link.group(1)
    return value.rstrip("/")


def join_url(base_url: str, path: str) -> str:
    base = normalize_base_url(base_url)
    p = path.strip()
    if not p.startswith("/"):
        p = "/" + p
    if base.endswith("/v1") and p.startswith("/v1/"):
        p = p[3:]
    return base + p


def public_endpoint(ep: dict[str, Any]) -> dict[str, Any]:
    result = dict(ep)
    key = result.pop("api_key", "")
    result["has_api_key"] = bool(key)
    result["api_key_hint"] = mask_key(key)
    result["generation_capabilities"] = generation_capabilities(ep)
    return result


ReasoningParameter = Literal["auto", "reasoning_effort", "thinking", "enable_thinking"]
TokenParameter = Literal["auto", "max_tokens", "max_completion_tokens"]


class EndpointInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    base_url: str = Field(min_length=1)
    api_key: str | None = None
    model: str = Field(min_length=1)
    chat_path: str = "/v1/chat/completions"
    models_path: str = "/v1/models"
    timeout_seconds: float | None = Field(default=30, ge=0)
    enabled: bool = True
    extra_headers: dict[str, str] = Field(default_factory=dict)
    reasoning_effort: str = ""
    reasoning_parameter: ReasoningParameter = "auto"
    token_parameter: TokenParameter = "auto"
    stream: bool | None = None


class EndpointUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    chat_path: str | None = None
    models_path: str | None = None
    timeout_seconds: float | None = Field(default=None, ge=0)
    enabled: bool | None = None
    extra_headers: dict[str, str] | None = None
    reasoning_effort: str | None = None
    reasoning_parameter: ReasoningParameter | None = None
    token_parameter: TokenParameter | None = None
    stream: bool | None = None


class TestRequest(BaseModel):
    prompt: str = Field(min_length=1)
    endpoint_ids: list[str] | None = None
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, ge=1)
    reasoning_effort: str | None = None
    stream: bool | None = None
    timeout_seconds: float | None = Field(default=0, ge=0)


class ModelProbeRequest(BaseModel):
    base_url: str = Field(min_length=1)
    api_key: str | None = None
    models_path: str = "/v1/models"
    timeout_seconds: float | None = Field(default=30, ge=0)
    extra_headers: dict[str, str] = Field(default_factory=dict)
    endpoint_id: str | None = None


class HistoryDeleteRequest(BaseModel):
    ids: list[str] | None = None


def load_endpoints() -> list[dict[str, Any]]:
    return read_json(ENDPOINTS_FILE, [])


def save_endpoints(items: list[dict[str, Any]]) -> None:
    write_json(ENDPOINTS_FILE, items)


def load_history() -> list[dict[str, Any]]:
    return read_json(HISTORY_FILE, [])


def append_history(records: list[dict[str, Any]]) -> None:
    history = load_history()
    history.extend(records)
    # Keep the file bounded for a lightweight local app.
    history = history[-2000:]
    write_json(HISTORY_FILE, history)


def find_endpoint(endpoint_id: str) -> dict[str, Any]:
    for ep in load_endpoints():
        if ep.get("id") == endpoint_id:
            return ep
    raise HTTPException(status_code=404, detail="Endpoint not found")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/endpoints")
async def get_endpoints():
    return [public_endpoint(ep) for ep in load_endpoints()]


@app.get("/api/endpoints/{endpoint_id}/api-key")
async def get_endpoint_api_key(endpoint_id: str):
    ep = find_endpoint(endpoint_id)
    return JSONResponse(
        {"api_key": ep.get("api_key") or ""},
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/endpoints")
async def create_endpoint(payload: EndpointInput):
    items = load_endpoints()
    ep = payload.model_dump()
    ep["id"] = uuid.uuid4().hex[:12]
    ep["created_at"] = utc_now()
    ep["updated_at"] = ep["created_at"]
    ep["base_url"] = normalize_base_url(ep["base_url"])
    ep["api_key"] = (ep.get("api_key") or "").strip()
    items.append(ep)
    save_endpoints(items)
    return public_endpoint(ep)


@app.put("/api/endpoints/{endpoint_id}")
async def update_endpoint(endpoint_id: str, payload: EndpointUpdate):
    items = load_endpoints()
    for idx, ep in enumerate(items):
        if ep.get("id") != endpoint_id:
            continue
        patch = payload.model_dump(exclude_unset=True)
        # Blank API key means "keep existing key"; use "__CLEAR__" to explicitly clear.
        if "api_key" in patch:
            key = patch["api_key"]
            if key is None or key == "":
                patch.pop("api_key")
            elif key == "__CLEAR__":
                patch["api_key"] = ""
            else:
                patch["api_key"] = key.strip()

        if "base_url" in patch and patch["base_url"] is not None:
            patch["base_url"] = normalize_base_url(patch["base_url"])

        ep.update({k: v for k, v in patch.items() if v is not None or k == "stream"})
        ep["updated_at"] = utc_now()
        items[idx] = ep
        save_endpoints(items)
        return public_endpoint(ep)

    raise HTTPException(status_code=404, detail="Endpoint not found")


@app.delete("/api/endpoints/{endpoint_id}")
async def delete_endpoint(endpoint_id: str):
    items = load_endpoints()
    new_items = [ep for ep in items if ep.get("id") != endpoint_id]
    if len(new_items) == len(items):
        raise HTTPException(status_code=404, detail="Endpoint not found")
    save_endpoints(new_items)
    return {"ok": True}


def build_headers(ep: dict[str, Any]) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    api_key = (ep.get("api_key") or "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    for k, v in (ep.get("extra_headers") or {}).items():
        headers[str(k)] = str(v)
    return headers


def extract_models(data: Any) -> list[str]:
    candidates: Any = data
    if isinstance(data, dict):
        candidates = data.get("data")
        if not isinstance(candidates, list):
            candidates = data.get("models")
    if not isinstance(candidates, list):
        return []

    models: list[str] = []
    for item in candidates:
        model = None
        if isinstance(item, str):
            model = item
        elif isinstance(item, dict):
            model = item.get("id") or item.get("name") or item.get("model")
        if model is not None and str(model) not in models:
            models.append(str(model))
    return models


def upstream_error(data: Any, text: str) -> str:
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error)
        if error:
            return str(error)
        if data.get("message"):
            return str(data["message"])
        if data.get("detail"):
            return str(data["detail"])
    return text[:4000] or "Upstream returned an empty response."


async def probe_model_access(
    ep: dict[str, Any],
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    url = join_url(ep["base_url"], ep.get("models_path") or "/v1/models")
    started = time.perf_counter()
    result: dict[str, Any] = {
        "ok": False,
        "auth_status": "unknown",
        "http_status": None,
        "latency_ms": None,
        "request_url": url,
        "models": [],
        "error": None,
        "raw_response": None,
    }

    async def send(active_client: httpx.AsyncClient) -> httpx.Response:
        return await active_client.get(url, headers=build_headers(ep))

    try:
        if client is None:
            timeout = httpx.Timeout(ep.get("timeout_seconds", 30) or None)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as active_client:
                response = await send(active_client)
        else:
            response = await send(client)

        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
        result["http_status"] = response.status_code
        result["ok"] = response.is_success
        if response.is_success:
            result["auth_status"] = "accepted"
        elif response.status_code in (401, 403):
            result["auth_status"] = "rejected"

        text = response.text
        try:
            data = response.json()
            result["raw_response"] = data
        except Exception:
            data = None
            result["raw_response"] = text[:4000]

        if response.is_success:
            result["models"] = extract_models(data)
            if data is None:
                result["error"] = "请求成功，但响应不是有效 JSON，无法读取模型列表。"
            elif not result["models"]:
                result["error"] = "请求成功，但响应中没有识别到模型列表。"
        else:
            result["error"] = upstream_error(data, text)
        return result
    except httpx.TimeoutException:
        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
        result["error"] = f"请求在 {ep.get('timeout_seconds', 30)} 秒后超时。"
        return result
    except httpx.ConnectError as exc:
        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
        result["error"] = f"连接失败：{exc}"
        return result
    except Exception as exc:
        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result


def reasoning_parameter(ep: dict[str, Any]) -> str:
    parameter = ep.get("reasoning_parameter") or "auto"
    if parameter != "auto":
        return parameter
    model = ep["model"].lower()
    if model.startswith("longcat") or "api.longcat.chat" in ep["base_url"].lower():
        return "thinking"
    if model.startswith("qwen"):
        return "enable_thinking"
    return "reasoning_effort"


def generation_capabilities(ep: dict[str, Any]) -> dict[str, Any]:
    parameter = reasoning_parameter(ep)
    model = ep["model"].lower()
    switch_only = parameter in {"thinking", "enable_thinking"}
    always_thinking = model.rsplit("/", 1)[-1] == "glm-5.3-flash"
    efforts = ["", "none", "enabled"] if switch_only else [
        "", "none", "enabled", "minimal", "low", "medium", "high", "xhigh", "max"
    ]
    if always_thinking:
        efforts = ["", "enabled"] if switch_only else ["", "enabled", "low", "high", "max"]
    auto_stream = model.startswith("longcat") or "api.longcat.chat" in ep["base_url"].lower()
    return {
        "reasoning_parameter": parameter,
        "allowed_efforts": efforts,
        "switch_only": switch_only,
        "always_thinking": always_thinking,
        "default_stream": ep.get("stream") if ep.get("stream") is not None else auto_stream,
    }


@app.post("/api/generation-capabilities")
async def get_generation_capabilities(payload: dict[str, Any]):
    return generation_capabilities({
        "model": str(payload.get("model") or ""),
        "base_url": str(payload.get("base_url") or ""),
        "reasoning_parameter": payload.get("reasoning_parameter") or "auto",
    })


def build_chat_body(
    ep: dict[str, Any],
    prompt: str,
    temperature: float | None,
    max_tokens: int | None,
    reasoning_effort: str | None,
    stream: bool | None = None,
) -> dict[str, Any]:
    capabilities = generation_capabilities(ep)
    body: dict[str, Any] = {
        "model": ep["model"],
        "messages": [{"role": "user", "content": prompt}],
        "stream": capabilities["default_stream"] if stream is None else stream,
    }
    if temperature is not None:
        body["temperature"] = temperature
    if max_tokens is not None:
        token_parameter = ep.get("token_parameter") or "auto"
        if token_parameter == "auto":
            token_parameter = (
                "max_completion_tokens"
                if re.match(r"^(gpt-|o[1-9](?:-|$))", ep["model"], re.IGNORECASE)
                else "max_tokens"
            )
        body[token_parameter] = max_tokens

    effort = ep.get("reasoning_effort", "") if reasoning_effort is None else reasoning_effort
    if effort not in capabilities["allowed_efforts"]:
        if capabilities["always_thinking"]:
            raise ValueError("This model requires thinking. Choose provider default, on, low, high or max.")
        if capabilities["switch_only"]:
            raise ValueError("This reasoning format supports only on/off, not effort levels. Choose provider default, on or off.")
        raise ValueError("Unsupported reasoning effort. Choose none, minimal, low, medium, high, xhigh or max.")
    if effort and not (capabilities["always_thinking"] and effort == "enabled"):
        parameter = capabilities["reasoning_parameter"]
        if parameter == "thinking":
            body["thinking"] = {"type": "disabled" if effort == "none" else "enabled"}
        elif parameter == "enable_thinking":
            body["enable_thinking"] = effort != "none"
        else:
            body["reasoning_effort"] = "medium" if effort == "enabled" else effort
    return body


def text_content(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        return "\n".join(
            part["text"] for part in value
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        )
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


async def collect_chat_stream(response: httpx.Response, result: dict[str, Any], started: float):
    data_lines: list[str] = []
    content: list[str] = []
    reasoning: list[str] = []
    result["response_format"] = "sse"
    result["stream_complete"] = False
    result["stream_events"] = 0

    def event(payload: str):
        if payload == "[DONE]":
            result["stream_complete"] = True
            return
        data = json.loads(payload)
        result["stream_events"] += 1
        if result.get("first_event_ms") is None:
            result["first_event_ms"] = round((time.perf_counter() - started) * 1000)
        if data.get("error"):
            result["error"] = upstream_error(data, "")
            result["error_code"] = "upstream_stream_error"
            return
        result["returned_model"] = data.get("model") or result["returned_model"]
        if data.get("usage") is not None:
            result["usage"] = data["usage"]
        for choice in data.get("choices") or []:
            if choice.get("index", 0) != 0:
                continue
            delta = choice.get("delta") or {}
            final = text_content(delta.get("content"))
            thought = text_content(delta.get("reasoning_content") or delta.get("reasoning"))
            if final:
                content.append(final)
                result["content"] = "".join(content)
            if thought:
                reasoning.append(thought)
                result["reasoning_content"] = "".join(reasoning)
            if choice.get("finish_reason") is not None:
                result["finish_reason"] = choice["finish_reason"]

    async for line in response.aiter_lines():
        if line == "":
            if data_lines:
                event("\n".join(data_lines))
                data_lines.clear()
            if result["stream_complete"] or result["error"]:
                break
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
    if data_lines and not result["stream_complete"] and not result["error"]:
        event("\n".join(data_lines))
    if result["finish_reason"] is not None:
        result["stream_complete"] = True
    if not result["stream_complete"] and not result["error"]:
        result["error_code"] = "stream_incomplete"
        result["error"] = "The stream ended before a completion marker. Any received partial reply has been preserved."


def finalize_chat_result(result: dict[str, Any], max_tokens: int | None):
    returned = result["returned_model"]
    if returned:
        result["model_match"] = str(returned) == str(result["requested_model"])
    if result["error"]:
        return
    if not (result["content"] or "").strip():
        usage = result["usage"] or {}
        reasoning_tokens = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0
        if result["finish_reason"] == "length" or (
            max_tokens is not None and (usage.get("completion_tokens") or 0) >= max_tokens
        ):
            result["error_code"] = "output_limit"
            result["error"] = "The output limit was reached before a final text reply. Increase or omit the output limit."
        elif result["reasoning_content"] or reasoning_tokens:
            result["error_code"] = "reasoning_only"
            result["error"] = "The service returned reasoning but no final text reply. Increase or omit the output limit, or reduce thinking."
        else:
            result["error_code"] = "empty_content"
            result["error"] = "HTTP 2xx, but no text content was found in choices."
        return
    result["ok"] = True


async def test_one(
    ep: dict[str, Any],
    prompt: str,
    temperature: float | None,
    max_tokens: int | None,
    reasoning_effort: str | None = None,
    timeout_seconds: float | None = None,
    stream: bool | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    effective_timeout = ep.get("timeout_seconds", 30) if timeout_seconds is None else timeout_seconds
    result: dict[str, Any] = {
        "id": uuid.uuid4().hex,
        "endpoint_id": ep["id"],
        "endpoint_name": ep["name"],
        "base_url": ep["base_url"],
        "request_url": join_url(ep["base_url"], ep.get("chat_path") or "/v1/chat/completions"),
        "requested_model": ep["model"],
        "returned_model": None,
        "model_match": None,
        "ok": False,
        "http_status": None,
        "latency_ms": None,
        "content": None,
        "reasoning_content": None,
        "finish_reason": None,
        "error_code": None,
        "error": None,
        "usage": None,
        "prompt": prompt,
        "generation_parameters": None,
        "started_at": utc_now(),
    }
    try:
        body = build_chat_body(ep, prompt, temperature, max_tokens, reasoning_effort, stream)
        result["generation_parameters"] = {
            **{key: value for key, value in body.items() if key not in {"model", "messages"}},
            "timeout_seconds": effective_timeout or None,
        }
    except ValueError as exc:
        result.update(error=str(exc), error_code="unsupported_setting")
        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
        return result

    async def send(active_client: httpx.AsyncClient):
        async with active_client.stream(
            "POST", result["request_url"], headers=build_headers(ep), json=body
        ) as response:
            result["http_status"] = response.status_code
            if response.is_success and "text/event-stream" in response.headers.get("content-type", ""):
                await collect_chat_stream(response, result, started)
                return
            raw = await response.aread()
            text = raw.decode("utf-8", errors="replace")
            try:
                data = json.loads(text)
            except ValueError:
                data = None
            if not response.is_success:
                result["error"] = upstream_error(data, text)
                return
            result["response_format"] = "json"
            if not isinstance(data, dict):
                result.update(error="HTTP 2xx, but the response is not valid JSON.", error_code="invalid_response")
                return
            result["returned_model"] = data.get("model")
            result["usage"] = data.get("usage")
            choices = data.get("choices") or []
            if choices and isinstance(choices[0], dict):
                choice = choices[0]
                message = choice.get("message") or {}
                result["content"] = text_content(message.get("content") if message.get("content") is not None else choice.get("text"))
                result["reasoning_content"] = text_content(message.get("reasoning_content") or message.get("reasoning"))
                result["finish_reason"] = choice.get("finish_reason")

    try:
        if client is None:
            async with httpx.AsyncClient(timeout=httpx.Timeout(effective_timeout or None), follow_redirects=True) as active:
                await send(active)
        else:
            await send(client)
        finalize_chat_result(result, max_tokens)
    except httpx.TimeoutException:
        result.update(error=f"Request timed out after {effective_timeout} seconds.", error_code="request_timeout")
    except httpx.RemoteProtocolError as exc:
        result.update(error=f"RemoteProtocolError: {exc}", error_code="upstream_disconnected")
    except httpx.ConnectError as exc:
        result.update(error=f"Connection failed: {exc}", error_code="connection_failed")
    except (ValueError, TypeError) as exc:
        result.update(error=f"Invalid response: {exc}", error_code="invalid_response")
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        if result["returned_model"]:
            result["model_match"] = str(result["returned_model"]) == str(result["requested_model"])
        result["latency_ms"] = round((time.perf_counter() - started) * 1000)
    return result


@app.post("/api/test-all")
async def test_all(payload: TestRequest):
    endpoints = load_endpoints()
    selected = set(payload.endpoint_ids or [])
    if selected:
        endpoints = [ep for ep in endpoints if ep.get("id") in selected]
    else:
        endpoints = [ep for ep in endpoints if ep.get("enabled", True)]

    if not endpoints:
        raise HTTPException(status_code=400, detail="No enabled/selected endpoints to test")

    records = await asyncio.gather(
        *[
            test_one(ep, payload.prompt, payload.temperature, payload.max_tokens,
                     payload.reasoning_effort, payload.timeout_seconds, payload.stream)
            for ep in endpoints
        ]
    )
    append_history(records)
    return records


@app.post("/api/test/{endpoint_id}")
async def test_endpoint(endpoint_id: str, payload: TestRequest):
    ep = find_endpoint(endpoint_id)
    record = await test_one(ep, payload.prompt, payload.temperature, payload.max_tokens,
                            payload.reasoning_effort, payload.timeout_seconds, payload.stream)
    append_history([record])
    return record


@app.get("/api/models/{endpoint_id}")
async def get_models(endpoint_id: str):
    ep = find_endpoint(endpoint_id)
    return await probe_model_access(ep)


@app.post("/api/probe-models")
async def probe_models(payload: ModelProbeRequest):
    ep = payload.model_dump(exclude={"endpoint_id"})
    ep["base_url"] = normalize_base_url(ep["base_url"])
    ep["api_key"] = (ep.get("api_key") or "").strip()

    if payload.endpoint_id and not ep["api_key"]:
        saved = find_endpoint(payload.endpoint_id)
        ep["api_key"] = saved.get("api_key") or ""

    return await probe_model_access(ep)


@app.get("/api/history")
async def get_history(limit: int = 100):
    limit = max(1, min(limit, 1000))
    history = load_history()
    return list(reversed(history[-limit:]))


@app.delete("/api/history")
async def clear_history():
    write_json(HISTORY_FILE, [])
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
