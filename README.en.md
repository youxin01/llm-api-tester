# LLM API Tester

[![Contributors](https://img.shields.io/github/contributors/youxin01/llm-api-tester?style=flat&color=orange)](https://github.com/youxin01/llm-api-tester/graphs/contributors)
[![GitHub stars](https://img.shields.io/github/stars/youxin01/llm-api-tester?style=flat&color=yellow)](https://github.com/youxin01/llm-api-tester/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/youxin01/llm-api-tester?style=flat&color=green)](https://github.com/youxin01/llm-api-tester/forks)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-%3E%3D3.10-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Local only](https://img.shields.io/badge/deployment-local%20only-147D64?style=flat&logo=homeassistant&logoColor=white)](#local-deployment-and-privacy)

[中文](README.md) | [English](README.en.md)

**A local LLM API testing tool built with Python and FastAPI.**

Manage API URLs, keys and models. Test connections in parallel and inspect replies,
request durations and errors. Run the Python server and open the desktop browser UI;
no Node.js installation or frontend build is needed.

> 🏠 Run locally. Keep control of your data. No project account is required;
> configuration and history stay on your machine. Your local server sends API requests
> directly to your chosen endpoint, not through a project-operated server.

[Quick start](#quick-start) · [Features](#features) · [Local deployment and privacy](#local-deployment-and-privacy)

## Preview

These screenshots use fictional connections and simulated results, with no real keys.

![Connections and compact test summary](docs/images/workspace-demo.jpg)

<details>
<summary>View error details</summary>

![Error explanation and original server response](docs/images/error-detail-demo.jpg)

</details>

## Features

- 🔑 **Connection management:** add, edit, disable or delete connections; view, copy or replace saved keys.
- 🔎 **Model discovery:** enter a Base URL and key to retrieve the service’s model list without saving.
- ⚡ **Parallel testing:** test one connection, selected connections or all enabled connections, with incremental progress.
- 📋 **Direct results:** click a connection’s status to inspect the latest reply, HTTP status, requested/returned model, duration and original error.
- 🖥️ **Desktop workspace:** list/card views, search, status filters, failure filters and test history.
- 🌐 **Chinese / English:** choose a language in the top-right corner; the browser remembers it.
- ⚙️ **Custom settings:** request paths, timeout, reasoning parameters and extra headers, with local configuration and history.
- 💬 **Reusable prompts:** knowledge-cutoff and pelican tasks, plus your own editable prompt shortcuts.
- 🎨 **Generated content:** isolated HTML/SVG animation preview, source view and HTML download.

### API support

Supports **OpenAI-compatible Chat Completions endpoints**, with no restriction on model names.
Use compatible endpoints for GPT, DeepSeek, Qwen, GLM or a local vLLM server.

- Model requests: `POST /v1/chat/completions` by default, with non-streaming and upstream stream collection.
- Model listing: `GET /v1/models` by default.
- Authentication: Bearer API keys and custom headers.
- Duration: total time for a complete request.

## Quick start

Install **Python 3.10+**, then open a terminal in the project directory:

```bash
python -m pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:8765** in your browser.

The same Python entry point is used on Windows, macOS and Linux. If your system uses
`python3`, replace `python` with `python3` in both commands.
Conda and virtual environment activation are not required. Keep the terminal open;
press `Ctrl+C` to stop the server.

To get the source:

```bash
git clone https://github.com/youxin01/llm-api-tester.git
cd llm-api-tester
```

Alternatively, download and extract the ZIP, then enter the directory containing `app.py`.

## Usage

1. Choose **Add connection** and enter a name, Base URL, API key and a model supported by the service.
   The initial model, `gpt-5.6-sol`, is editable. Leave the key empty for a local service without authentication.
2. Use **Check key / models** to list models, or enter a known model directly and save.
   Some services do not provide a model list. Listed models still require a request test to confirm access.
3. Edit the prompt and choose **Test selected**, **Test all**, or test one connection.
   Selected tests include hidden selections; Test all includes every enabled connection.
4. Click a status to inspect the latest result. Expand the current run or browse history to copy replies and original errors.
5. Edit a connection to show or copy its key. Enter a new key and save to replace it; leaving it blank preserves the saved key.

Advanced settings include Chat Path, Models Path, timeout and JSON extra headers.
A Base URL ending in `/v1` is handled without duplicating the prefix.

Switching language does not translate custom prompts, connection names or provider responses,
and does not send new requests. The default prompt asks about the model’s knowledge cutoff.
**Pelican test** uses the original task:

> 创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画

Use **Custom prompts** to create, edit or delete prompts. Saved prompts become shortcut buttons.
They are stored in this browser and are removed when its site data is cleared.

### Output and reasoning

The output token limit is blank by default: no explicit length limit is sent.
Leave Temperature blank for the provider default. Request timeout defaults to 0 (no timeout);
leave it blank to use the connection timeout. Provider model limits, quotas and access rules still apply.

Reasoning can inherit a connection setting, use the provider default, be off/on, or use
a named effort level. Each connection can save its own default and parameter format.
Auto uses `thinking.type` for LongCat, `enable_thinking` for Qwen, and
`reasoning_effort` otherwise. Switch-only APIs offer only provider default, on and off;
named levels are rejected rather than silently converted to on. GLM-5.3-Flash always
reasons: its standard format offers default, on and low/high/max, without off.
Standard-format "on" normally sends `reasoning_effort: medium`; always-thinking models
use the provider default. Other supported levels depend on the service. An accepted
request does not prove that a service actually applied its requested effort.
Token limit fields can be automatic or explicitly set to
`max_tokens` / `max_completion_tokens`.

**Upstream response mode** offers auto, streaming and non-streaming, with per-connection
defaults. Auto streams LongCat and keeps other connections non-streaming. The backend
collects streamed output before showing the result; this is not a live token-by-token UI.
Results retain first-event timing, completion markers and received content.

Details retain returned reasoning (when available), token usage, finish reason and sent parameters.
An HTTP 200 without final text is explained separately. Reasoning can consume the output allowance;
an empty reply does not prove the key is invalid.
Disconnects and incomplete streams are failures with available partial text preserved,
without automatic retries.

### View HTML / SVG

When a reply contains HTML or SVG, choose **Preview HTML / SVG** in its details.
Animations run in an isolated sandbox, with source view and HTML download.
Generated code is not inserted into the workspace and network loading is isolated.
If the service reports truncation, the available content can still be previewed but may be incomplete.

## Local deployment and privacy

**Local execution, not hosted key storage.** The UI is served by your own Python process,
without a project-operated cloud backend or built-in usage analytics or telemetry uploads.
Model discovery and tests go directly from your local server to the API URL you enter.
The project does not relay these requests or collect your connections and test history.

- Connections: `data/endpoints.json`; history: `data/history.json`.
- Custom prompts and language preferences are stored in this browser.
- **Keys are stored in plaintext on your machine.** Prompts and credentials are sent to the API URL you specify.
- History keeps up to 2,000 records; the page loads the latest 100. Status reflects saved tests, not live monitoring.
- The server listens on `127.0.0.1` for personal local use. Do not expose it directly to the public internet.
- API tests may consume provider quota. Do not publish real keys, private configuration or history.

Local deployment removes an additional relay and hosted storage layer; it does not mean
zero risk. Use trusted API providers and protect your local files. How a third-party API
handles the data it receives depends on that provider’s policies.

## Development

Python, FastAPI, Uvicorn and HTTPX power the backend; the frontend uses native HTML, CSS and JavaScript.
Node.js is only used for frontend tests, through its built-in test runner.

```bash
python -m unittest discover -s tests -v
node --check static/i18n.js
node --check static/app.js
node --test static/api_key.test.cjs
```

When reporting an issue, include your OS, Python version, reproduction steps and redacted error output.

## License

[MIT License](LICENSE) · Copyright © 2026 youxin01
