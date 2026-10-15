# LLM API Tester

[![Contributors](https://img.shields.io/github/contributors/youxin01/llm-api-tester?style=flat&color=orange)](https://github.com/youxin01/llm-api-tester/graphs/contributors)
[![GitHub stars](https://img.shields.io/github/stars/youxin01/llm-api-tester?style=flat&color=yellow)](https://github.com/youxin01/llm-api-tester/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/youxin01/llm-api-tester?style=flat&color=green)](https://github.com/youxin01/llm-api-tester/forks)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-%3E%3D3.10-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Local only](https://img.shields.io/badge/deployment-local%20only-147D64?style=flat&logo=homeassistant&logoColor=white)](#本地运行与隐私)

[中文](README.md) | [English](README.en.md)

**基于 Python + FastAPI 的本地大模型 API 测试工具。**

管理 API 地址、密钥和模型，并行测试多个连接，查看模型回复、请求耗时与具体报错。
启动 Python 服务后，通过电脑浏览器使用，无需安装 Node.js 或构建前端。

> 🏠 本地部署，数据自己掌握。无需注册项目账号，配置与历史保存在本机；
> API 请求由本地服务直接发往你指定的地址，不经过项目方服务器。

[快速开始](#快速开始) · [主要功能](#主要功能) · [本地运行与隐私](#本地运行与隐私)

## 界面预览

以下为虚构站点与模拟测试结果，不包含真实密钥。

![站点管理与紧凑测试摘要](docs/images/workspace-demo.jpg)

<details>
<summary>查看错误诊断界面</summary>

![错误说明与服务端原始报错](docs/images/error-detail-demo.jpg)

</details>

## 主要功能

- 🔑 **连接管理**：添加、编辑、停用和删除多组 API 配置，查看、复制或替换已保存的密钥。
- 🔎 **模型检测**：填写 Base URL 与 Key 即可获取服务返回的模型列表，无需先保存。
- ⚡ **并行测试**：测试单个连接、选中连接或全部启用的连接，逐项显示进度。
- 📋 **结果直达**：点击连接上的状态，查看最近一次回复、HTTP 状态、请求与返回模型、耗时和原始报错。
- 🖥️ **桌面工作台**：列表 / 卡片切换，支持搜索、状态筛选、失败结果筛选和历史记录。
- 🌐 **中英切换**：右上角选择「中文 / English」，浏览器自动记住选择。
- ⚙️ **连接设置**：自定义请求路径、超时、思考参数和额外 Headers；配置与历史保存在本机。
- 💬 **Prompt 快捷入口**：内置知识截止时间、鹈鹕测试，可创建、编辑与直接复用自己的 Prompt。
- 🎨 **生成内容预览**：HTML / SVG 动画可隔离预览、查看源码并下载 HTML。

### 接口支持

支持 **OpenAI-compatible Chat Completions 接口**，不限制模型名称。
GPT、DeepSeek、Qwen、GLM、本地 vLLM 等可使用服务提供的兼容地址进行测试。

- 模型请求：默认 `POST /v1/chat/completions`，支持非流式与上游流式收集。
- 模型列表：默认 `GET /v1/models`。
- 认证：Bearer API Key 和自定义 Headers。
- 耗时：一次完整请求的总耗时。

## 快速开始

需要 **Python 3.10+**。在项目目录打开终端，执行：

```bash
python -m pip install -r requirements.txt
python app.py
```

然后用浏览器打开 **http://127.0.0.1:8765**。

Windows、macOS 和 Linux 使用同一套 Python 启动方式。如果系统的 Python 命令叫
`python3`，将上面两行中的 `python` 换成 `python3` 即可。
不强制使用 Conda 或虚拟环境。保持终端运行，按 `Ctrl+C` 停止服务。

获取源码：

```bash
git clone https://github.com/youxin01/llm-api-tester.git
cd llm-api-tester
```

也可以下载 ZIP，解压后进入包含 `app.py` 的目录。

## 使用方法

1. 点击「新增站点」，填写名称、Base URL、API Key 和服务支持的模型名。
   默认模型 `gpt-5.6-sol` 可自行修改；无需认证的本地服务可留空 Key。
2. 点击「检测 Key / 模型」查看模型列表，也可直接填写已知模型并保存。
   部分服务不提供列表接口；列表返回的模型仍需通过请求确认调用权限。
3. 修改测试内容，选择「测试选中」「全部测试」，或单独测试一个连接。
   「测试选中」包含筛选外已勾选的连接；「全部测试」覆盖所有已启用连接。
4. 点击状态查看最近结果；展开本轮进度或查看历史，复制回复 / 原始报错。
5. 编辑连接可显示、复制密钥；输入新密钥并保存即可替换，留空则保留原密钥。

高级设置可调整 Chat Path、Models Path、超时和 JSON 格式的额外 Headers。
Base URL 以 `/v1` 结尾时会自动避免重复拼接。

语言切换不会翻译自定义测试内容、连接名称或服务返回的原文，也不会重新发起测试。
默认测试内容询问知识截止时间；「鹈鹕测试」会填入：

> 创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画

点击「自定义 Prompt」可以新建、编辑或删除；保存后直接点快捷按钮即可填入。
自定义 Prompt 保存在当前浏览器，清除浏览器站点数据会一并清除。

### 输出与思考设置

「请求参数」中的输出 Token 上限默认留空，不发送额外长度限制；
Temperature 留空使用服务商默认值。本轮超时默认 0，表示不限时，
留空则使用连接的超时设置。供应商的模型长度、配额和访问限制仍然适用。

思考程度可选「使用站点设置」「服务商默认」「关闭 / 开启」或具体强度。
每个连接的高级设置可保存自己的默认值及参数格式：自动模式对 LongCat 使用
`thinking.type`，对 Qwen 使用 `enable_thinking`，其余使用 `reasoning_effort`。
仅支持开关的接口只能选择默认、开启或关闭，不会把强度档位静默转换为开启。
GLM-5.3-Flash 始终思考，标准格式支持默认、开启及 low/high/max，不提供关闭。
标准格式的「开启」通常发送 `reasoning_effort: medium`；始终思考模型使用服务默认。
其他具体档位由服务决定是否支持；请求被接受不等于能证明服务实际采用了该强度。
输出长度参数可自动选择或手动指定 `max_tokens` / `max_completion_tokens`。

「上游响应方式」可选自动、流式或非流式，并可按连接保存。
自动模式对 LongCat 使用流式，其他连接保持非流式。后端收集流式内容后统一显示结果，
不是逐字显示；结果保留首事件耗时、结束标记与已收到的内容。

结果详情会保留思考内容（服务返回时）、Token 消耗、结束原因与实际发送参数。
HTTP 200 但没有正文会单独说明；思考可能占用输出额度，不会因此认定密钥失效。
上游断开或流未完整结束时会标记失败并保留部分回复，不会自动重试。

### 查看 HTML / SVG

生成回复包含 HTML 或 SVG 时，在测试详情点击「预览 HTML / SVG」。
支持页面内动画、源码切换和下载。预览在独立沙箱中运行，不会注入工作台；
网络加载被隔离。服务报告截断时仍可预览已有内容，但结果可能不完整。

## 本地运行与隐私

**本地运行，不托管你的密钥。** 工作台页面由本机 Python 服务提供，
不依赖项目方云端，不内置使用统计或遥测上传。模型检测与测试由本地服务直接请求
你填写的 API 地址；项目方不代转这些请求，也不收集你的连接配置或测试记录。

- 连接配置：`data/endpoints.json`；测试历史：`data/history.json`。
- 自定义 Prompt 和语言偏好保存在当前浏览器。
- **密钥以明文保存在本机**；请求内容和密钥会发送到你指定的 API 服务。
- 历史最多保留 2000 条，页面加载最近 100 条。状态来自最近记录，不是实时监控。
- 程序默认只监听 `127.0.0.1`，供个人本地使用，请勿直接暴露到公网。
- API 测试可能消耗服务额度。分享截图或发布源码时，请勿包含真实密钥、私有配置与历史。

本地部署减少了额外的中转与托管环节，但不等于零风险：请使用可信的 API 服务，
并妥善保管本地文件。第三方 API 如何处理收到的数据，取决于其自身政策。

## 开发

后端使用 Python、FastAPI、Uvicorn 与 HTTPX，前端使用原生 HTML / CSS / JavaScript。
运行不需要 Node.js；以下前端测试使用 Node.js 内置测试运行器。

```bash
python -m unittest discover -s tests -v
node --check static/i18n.js
node --check static/app.js
node --test static/api_key.test.cjs
```

报告问题时请附上操作系统、Python 版本、复现步骤与脱敏后的错误信息。

## 许可证

[MIT License](LICENSE) · Copyright © 2026 youxin01
