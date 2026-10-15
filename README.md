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

填写 URL 和 Key，检测模型、批量测试、查看回复与报错。无需注册，无需前端构建。

[快速开始](#快速开始) · [主要功能](#主要功能) · [本地运行与隐私](#本地运行与隐私)

## 界面预览

![站点管理与测试结果](docs/images/workspace-demo.jpg)

<details>
<summary>查看错误诊断界面</summary>

![错误说明与原始报错](docs/images/error-detail-demo.jpg)

</details>

*截图使用虚构站点与模拟结果。*

## 主要功能

- 🔑 **连接管理**：管理多组 API，查看、复制和替换密钥。
- 🔎 **模型检测**：输入 URL 和 Key，获取服务提供的模型列表。
- ⚡ **批量测试**：单站、选中或全部测试，逐项显示进度。
- 📋 **结果直达**：点击状态查看回复、HTTP 状态、耗时与报错。
- 🖥️ **桌面工作台**：列表 / 卡片切换，搜索、筛选与历史记录。
- ⚙️ **请求设置**：思考程度、输出长度、超时与自定义 Headers。
- 💬 **自定义 Prompt**：保存常用任务，内置知识截止时间与鹈鹕测试。
- 🎨 **内容预览**：预览 HTML / SVG 动画，查看源码并下载。
- 🌐 **中英切换**：中文 / English，自动记住语言偏好。

支持 **OpenAI-compatible Chat Completions**，适用于 GPT、DeepSeek、Qwen、GLM、本地 vLLM 等兼容服务。
具体模型与参数支持以服务商为准。

## 快速开始

需要 **Python 3.10+**，Windows / macOS / Linux 使用相同命令：

```bash
git clone https://github.com/youxin01/llm-api-tester.git
cd llm-api-tester
python -m pip install -r requirements.txt
python app.py
```

浏览器打开 **http://127.0.0.1:8765**。若系统使用 `python3`，替换命令中的 `python` 即可。

## 使用方法

1. **添加连接**：填写名称、URL、Key 和模型；也可点击「检测 Key / 模型」。
2. **开始测试**：选择 Prompt 和站点，点击测试。
3. **查看结果**：点击「可用 / 失败」查看详情；HTML / SVG 回复可直接预览。

<details>
<summary>可选设置</summary>

- 默认模型为 `gpt-5.6-sol`，可自行修改；模型列表不等于调用权限。
- 输出长度和 Temperature 留空使用服务商默认；本轮超时 `0` 表示不限时。
- 思考档位按接口适配，开关型接口只提供开启 / 关闭。
- LongCat 自动使用上游流式；内容收集完成后显示，断流时保留部分回复。
- 编辑连接时，Key 留空保留原密钥；自定义 Prompt 保存在当前浏览器。

</details>

## 本地运行与隐私

- 🏠 配置与历史保存在本机，无项目方云端中转或遥测上传。
- 🔐 Key 明文保存在 `data/endpoints.json`，历史在 `data/history.json`；请勿公开。
- 📡 测试会将 Key 和 Prompt 发往你指定的 API，并可能消耗额度；请使用可信服务。
- 🖥️ 默认仅监听 `127.0.0.1`，供本地使用，请勿直接暴露到公网。

## 开发

<details>
<summary>运行测试（前端测试需 Node.js）</summary>

```bash
python -m unittest discover -s tests -v
node --test static/api_key.test.cjs
```

</details>

## 许可证

[MIT License](LICENSE) · Copyright © 2026 youxin01
