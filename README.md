# Python Starter Agent

A minimal Python LLM Agent template on EdgeOne Pages Functions. Demonstrates how to build a streaming chat Agent with raw `httpx` calls, EdgeOne sandbox tool calling, and session memory via `context.store`.

## Features

- **Streaming Chat** — SSE (Server-Sent Events) token-by-token response push
- **Session Memory** — Persists multi-turn conversation context via EdgeOne `context.store`
- **EdgeOne Sandbox Tools** — commands, files, code_interpreter, browser — bridged via OpenAI-compatible function calling
- **Tool Calling Loop** — Model returns `tool_calls` → execute via EdgeOne sandbox → send results back → repeat until final answer
- **Stop Generation** — Truly interrupts the LLM call via platform runtime cancel signal
- **Tool Indicators** — 4 animated lamps light up when the model calls a tool

## Directory Structure

```text
python-starter/
├── agents/                        # Python backend (EdgeOne Pages Functions)
│   ├── chat/
│   │   ├── index.py              # POST /chat — main chat entry (SSE streaming)
│   │   └── stop.py               # POST /chat/stop — abort active run
│   ├── history/
│   │   └── index.py              # POST /history — conversation history
│   ├── _model.py                 # LLM model config (private module)
│   ├── _logger.py                # Logger utility (private module)
│   ├── _session.py               # Session persistence adapter (private module)
│   └── _tools.py                 # EdgeOne tool registry (private module)
├── src/                           # React frontend (Vite + TypeScript)
│   ├── App.tsx                    # Main app component
│   ├── api.ts                    # Backend API wrappers (SSE streaming)
│   ├── types.ts                  # Type definitions
│   └── components/               # UI components
│       ├── ChatWindow.tsx        # Chat window
│       ├── ChatBubble.tsx        # Message bubble (Markdown support)
│       ├── ChatInput.tsx         # Input box + presets + stop button
│       ├── CodeViewer.tsx        # Code display panel (CRT aesthetic)
│       ├── ToolIndicators.tsx    # Tool indicator container
│       └── ToolLamp.tsx          # Single tool indicator lamp
├── index.html                    # Entry HTML
├── package.json                  # Frontend dependencies
├── vite.config.ts                # Vite config
├── tsconfig.json                 # TypeScript config
├── requirements.txt              # Python dependencies
└── .env.example                  # Environment variables template
```

> Files prefixed with `_` are private modules — not mapped as public routes by EdgeOne.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | LLM API key |
| `AI_GATEWAY_BASE_URL` | Yes | LLM API base URL (OpenAI-compatible) |
| `AI_GATEWAY_MODEL` | No | Model name (default: `@makers/minimax-m2.7`) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat` | POST | SSE streaming chat. Header: `pages-agent-conversation-id` |
| `/chat/stop` | POST | Abort the active agent run. Body: `{ "conversation_id": "..." }` |
| `/history` | POST | Get conversation history. Header: `pages-agent-conversation-id` |

### SSE Events

```
event: text_delta     data: {"delta":"Hello"}
event: tool_called    data: {"tool":"commands"}
event: ping           data: {"ts":1710000000000}
event: error          data: {"message":"..."}
event: done           data: {"stopped":false}
```

## Architecture

### Backend (`agents/`)

1. **`ChatSession(context.store)`** — Wraps EdgeOne Store for conversation history persistence
2. **`build_tools(context)`** — Extracts EdgeOne sandbox tools from `context.tools` and converts to OpenAI function calling schema
3. **`httpx` streaming** — Calls OpenAI-compatible `/chat/completions` with tool definitions
4. **Tool loop** (up to 10 rounds) — If model returns `tool_calls`, execute them via `tool_registry.execute()`, append results, re-request
5. **SSE output** — Yields `text_delta`, `tool_called`, `done`, `error`, `ping` events

### Frontend (`src/`)

- `App.tsx` — Orchestrates chat panel + code viewer, manages SSE stream
- `api.ts` — SSE parsing, dispatches `onTextDelta`, `onToolCalled`, `onDone`, `onError`
- `components/CodeViewer.tsx` — Static code display panel (amber CRT aesthetic) showing the agent flow
- `components/ToolIndicators.tsx` — Animated tool lamps that flash when tools are called

## Local Development

```bash
# Install frontend dependencies
npm install

# Start EdgeOne local dev (frontend + backend)
edgeone pages dev
```
