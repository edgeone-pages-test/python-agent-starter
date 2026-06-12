# Python Starter Agent

A minimal Python LLM Agent template on EdgeOne Makers — built on raw `httpx` against an OpenAI-compatible Chat Completions endpoint, with EdgeOne sandbox tool calling and `context.store`-backed conversation memory. No agent framework.

**Framework:** None (raw Python) · **Category:** Quick Start <!-- TODO: confirm --> · **Language:** Python

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=python-starter-agent&from=within&fromAgent=1&agentLang=python)

<!-- ![preview](./assets/preview.png)  TODO: confirm -->

## Overview

The smallest reasonable starting point if you want a Python chat Agent without committing to a framework. The whole loop — prompt → stream LLM → execute tool calls → loop → final answer — is plain `httpx` and a small `tool_registry`. Read the source top-to-bottom and you've seen everything.

- **SSE streaming chat** — token-by-token push of `text_delta`, plus `tool_called` events.
- **EdgeOne sandbox tools** — `commands`, `files`, `code_interpreter`, `browser` are pulled from `context.tools` and exposed as OpenAI function calling tools.
- **Tool-calling loop** — up to 10 rounds: model returns `tool_calls` → execute via `tool_registry.execute()` → append results → re-request, until a final answer.
- **Conversation memory** — `ChatSession(context.store)` reads/writes per-conversation history via the EdgeOne store.
- **Honest cancellation** — frontend `AbortController` plus backend `context.request.signal` actually release the upstream LLM connection.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | Model gateway API key. Use your Makers Models API Key, or any OpenAI-compatible provider key. |
| `AI_GATEWAY_BASE_URL` | Yes | Gateway base URL. For Makers Models, use `https://ai-gateway.edgeone.link/v1`. |
| `AI_GATEWAY_MODEL` | No | Model ID. Defaults to `@makers/deepseek-v4-flash` (a free built-in model). |
| `WSA_API_KEY` | No | Tencent Cloud Web Search API key. Required only if you use the web-search tool. |

This template follows the OpenAI-compatible standard — point these at Makers Models or any compatible provider.

### How to get `AI_GATEWAY_API_KEY`

1. Open the [Makers Console](https://edgeone.ai/makers/new?s_url=https://console.tencentcloud.com/edgeone/makers).
2. Sign in and enable Makers.
3. Go to **Makers → Models → API Key** and create a key.
4. Copy it into `AI_GATEWAY_API_KEY`.

The built-in `@makers/deepseek-v4-flash` model is free with a usage cap and is suitable for prototyping. For production, bind your own paid provider (BYOK).

### How to get `WSA_API_KEY`

`WSA_API_KEY` is only needed when calling the web-search tool. See the [documentation](https://pages.edgeone.ai/document/sandbox-network-search-tool).

## Local Development

Prerequisites: Node.js ≥ 18, Python ≥ 3.10, and the EdgeOne CLI (`npm i -g edgeone`).

```bash
npm install
pip install -r requirements.txt
cp .env.example .env       # then fill in AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL
edgeone makers dev
```

Local agent metrics & traces are exposed at `http://localhost:8080/agent-metrics`.

## Project Structure

```text
python-starter/
├── agents/                          # Python backend (EdgeOne Makers Agent Functions, stateful)
│   ├── chat/index.py               # POST /chat — SSE streaming chat with tool loop
│   ├── chat/stop.py                # POST /chat/stop — abort active run
│   ├── _model.py                   # LLM model config (private)
│   ├── _logger.py                  # Logger utility (private)
│   ├── _session.py                 # Session adapter over context.store (private)
│   └── _tools.py                   # EdgeOne tool registry (private)
├── cloud-functions/                 # Python backend (EdgeOne Makers Python cloud functions, stateless)
│   ├── history/index.py            # POST /history — conversation history
│   └── _logger.py                  # Logger utility (private)
├── src/                             # React + Vite + TypeScript frontend
│   ├── App.tsx                     # Main app + SSE stream lifecycle
│   ├── api.ts                      # /chat, /chat/stop, /history wrappers
│   └── components/                 # ChatWindow, ChatInput, CodeViewer, ToolIndicators, ...
├── package.json                     # Frontend dependencies
├── requirements.txt                 # Python dependencies
├── vite.config.ts
├── tsconfig.json
└── .env.example
```

> Files prefixed with `_` are private modules — not exposed as public routes.

## Resources

- [EdgeOne Makers Agents — Documentation](https://pages.edgeone.ai/document/agents)
- [EdgeOne Makers — Quick Start](https://pages.edgeone.ai/document/agents-quick-start)
- [Makers Models](https://pages.edgeone.ai/document/models)

## License

MIT.
