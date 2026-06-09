# Python Starter Agent

**语言：** [English](./README.md) | 简体中文

跑在 EdgeOne Makers 上的极简 Python LLM Agent 模板：直接用原生 `httpx` 调 OpenAI 兼容的 Chat Completions，搭配 EdgeOne 沙箱工具调用与基于 `context.store` 的会话记忆。不依赖任何 Agent 框架。

**Framework：** None (raw Python) · **Category：** Quick Start <!-- TODO: confirm --> · **Language：** Python

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=python-starter-agent&from=within&fromAgent=1&agentLang=python)

<!-- ![preview](./assets/preview.png)  TODO: confirm -->

## 概述

如果你想要一个不依赖任何 Agent 框架的最小 Python 起点，这就是。整条主流程 —— 拼 prompt → 流式调 LLM → 执行 tool_calls → 续请求 → 收尾，全部用原生 `httpx` 和一个小巧的 `tool_registry` 写完。从上到下读完，就把全部都看完了。

- **SSE 流式聊天** —— 逐 token 推 `text_delta`，命中工具时推 `tool_called`。
- **EdgeOne 沙箱工具** —— 从 `context.tools` 拉出 `commands` / `files` / `code_interpreter` / `browser`，转成 OpenAI function calling schema。
- **工具调用循环** —— 最多 10 轮：模型返回 `tool_calls` → `tool_registry.execute()` → 追加结果 �� 续请求，直到给出最终答案。
- **会话记忆** —— `ChatSession(context.store)` 通过 EdgeOne Store 读写按会话维度的历史。
- **可信取消** —— 前端 `AbortController` + 后端 `context.request.signal` 真正释放上游 LLM 连接。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | 模型网关 API Key。可填 Makers Models 的 API Key，也可以是任意 OpenAI 兼容服务商的 Key。 |
| `AI_GATEWAY_BASE_URL` | 是 | 网关 Base URL。Makers Models 请使用 `https://ai-gateway.edgeone.link/v1`。 |
| `AI_GATEWAY_MODEL` | 否 | 模型 ID。当前 `.env.example` 默认 `@makers/minimax-m2.7`；如需使用免费内置模型可改为 `@makers/deepseek-v4-flash`。 |

模板遵循 OpenAI 兼容协议，可以指向 Makers Models，也可以指向任意 OpenAI 兼容的服务商。

### 如何获取 `AI_GATEWAY_API_KEY`

1. 打开 [Makers 控制台](https://console.cloud.tencent.com/edgeone/makers)。
2. 登录并开通 Makers。
3. 进入 **Makers → Models → API Key**，新建一个 Key。
4. 把它粘到 `AI_GATEWAY_API_KEY`。

内置的 `@makers/deepseek-v4-flash` 免费但有用量限制，适合验证；生产建议自行绑定付费厂商（BYOK）。

## 本地开发

前置依赖：Node.js ≥ 18、Python ≥ 3.10，以及 EdgeOne CLI（`npm i -g edgeone`）。

```bash
npm install
pip install -r requirements.txt
cp .env.example .env       # 然后填入 AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL
edgeone makers dev
```

本地观测面板：`http://localhost:8080/agent-metrics`。

## 项目结构

```text
python-starter/
├── agents/                          # Python 后端（EdgeOne Makers Agent Functions，有状态）
│   ├── chat/index.py               # POST /chat —— SSE 流式聊天 + 工具循环
│   ├── chat/stop.py                # POST /chat/stop —— 中断当前 agent
│   ├── _model.py                   # LLM 模型配置（私有）
│   ├── _logger.py                  # 日志工具（私有）
│   ├── _session.py                 # 基于 context.store 的会话适配（私有）
│   └── _tools.py                   # EdgeOne 工具注册表（私有）
├── cloud-functions/                 # Python 后端（EdgeOne Pages Python cloud functions，无状态）
│   ├── history/index.py            # POST /history —— 对话历史
│   └── _logger.py                  # 日志工具（私有）
├── src/                             # React + Vite + TypeScript 前端
│   ├── App.tsx                     # 主应用 + SSE 流生命周期管理
│   ├── api.ts                      # /chat、/chat/stop、/history 接口封装
│   └── components/                 # ChatWindow、ChatInput、CodeViewer、ToolIndicators 等
├── package.json                     # 前端依赖
├── requirements.txt                 # Python 依赖
├── vite.config.ts
├── tsconfig.json
└── .env.example
```

> 以 `_` 开头的文件是私有模块，不会暴露为公开路由。

## 资源

- [EdgeOne Makers Agents 文档](https://pages.edgeone.ai/document/agents)
- [EdgeOne Makers 快速开始](https://pages.edgeone.ai/document/agents-quickstart)
- [Makers Models](https://pages.edgeone.ai/document/models)

## License

MIT.
