# Python Starter Agent

基于 EdgeOne Pages Functions 的极简 Python LLM Agent 模板。演示如何使用原生 `httpx` 调用 OpenAI-compatible 接口，配合 EdgeOne 沙箱工具和 `context.store` 会话记忆，构建流式聊天 Agent。

## 功能

- **流式聊天** — SSE (Server-Sent Events) 逐 token 推送模型回复
- **会话记忆** — 基于 EdgeOne `context.store` 自动维护多轮对话上下文
- **EdgeOne 沙箱工具** — commands、files、code_interpreter、browser，通过 OpenAI function calling 协议桥接
- **工具调用循环** — 模型返回 `tool_calls` → 调用 EdgeOne 沙箱执行 → 结果发回模型 → 循环直到最终回答
- **停止生成** — 通过平台 runtime cancel signal 真正中断 LLM 调用
- **工具灯状态** — 4 个动画指示灯，模型调用工具时实时点亮

## 目录结构

```text
python-starter/
├── agents/                        # Python 后端（EdgeOne Pages Functions）
│   ├── chat/
│   │   ├── index.py              # POST /chat — 主聊天入口（SSE 流式）
│   │   └── stop.py               # POST /chat/stop — 中断入口
│   ├── history/
│   │   └── index.py              # POST /history — 对话历史
│   ├── _model.py                 # LLM 模型配置（私有模块）
│   ├── _logger.py                # 日志工具（私有模块）
│   ├── _session.py               # 会话持久化适配器（私有模块）
│   └── _tools.py                 # EdgeOne 工具注册表（私有模块）
├── src/                           # React 前端（Vite + TypeScript）
│   ├── App.tsx                    # 主应用组件
│   ├── api.ts                    # 后端 API 封装（SSE 流式调用）
│   ├── types.ts                  # 类型定义
│   └── components/               # UI 组件
│       ├── ChatWindow.tsx        # 聊天窗口
│       ├── ChatBubble.tsx        # 消息气泡（支持 Markdown）
│       ├── ChatInput.tsx         # 输入框 + 预设 + 停止按钮
│       ├── CodeViewer.tsx        # 代码展示面板（CRT 风格）
│       ├── ToolIndicators.tsx    # 工具指示灯容器
│       └── ToolLamp.tsx          # 单个工具指示灯
├── index.html                    # 入口 HTML
├── package.json                  # 前端依赖
├── vite.config.ts                # Vite 配置
├── tsconfig.json                 # TypeScript 配置
├── requirements.txt              # Python 依赖
└── .env.example                  # 环境变量模板
```

> 以 `_` 开头的文件是私有模块，不会被 EdgeOne 映射为公开路由。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `AI_GATEWAY_API_KEY` | 是 | LLM API 密钥 |
| `AI_GATEWAY_BASE_URL` | 是 | LLM API 地址（OpenAI 兼容） |
| `AI_GATEWAY_MODEL` | 否 | 模型名称（默认 `@makers/minimax-m2.7`） |

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/chat` | POST | SSE 流式聊天，Header 带 `pages-agent-conversation-id` |
| `/chat/stop` | POST | 中断正在执行的 agent，Body 传 `{ "conversation_id": "..." }` |
| `/history` | POST | 获取对话历史，Header 带 `pages-agent-conversation-id` |

### SSE 事件

```
event: text_delta     data: {"delta":"你好"}
event: tool_called    data: {"tool":"commands"}
event: ping           data: {"ts":1710000000000}
event: error          data: {"message":"..."}
event: done           data: {"stopped":false}
```

## 架构

### 后端（`agents/`）

1. **`ChatSession(context.store)`** — 封装 EdgeOne Store，用于对话历史持久化
2. **`build_tools(context)`** — 从 `context.tools` 提取 EdgeOne 沙箱工具并转换为 OpenAI function calling schema
3. **`httpx` 流式请求** — 调用 OpenAI-compatible `/chat/completions`，附带工具定义
4. **工具调用循环**（最多 10 轮） — 模型返回 `tool_calls` 时，通过 `tool_registry.execute()` 执行，将结果追加到 messages 并重新请求
5. **SSE 输出** — 依次 yield `text_delta`、`tool_called`、`done`、`error`、`ping` 事件

### 前端（`src/`）

- `App.tsx` — 编排聊天面板 + 代码查看器，管理 SSE 流
- `api.ts` — SSE 解析，分发 `onTextDelta`、`onToolCalled`、`onDone`、`onError`
- `components/CodeViewer.tsx` — 静态代码展示面板（琥珀 CRT 风格），展示 Agent 流程
- `components/ToolIndicators.tsx` — 模型调用工具时的动画指示灯

## 本地开发

```bash
# 安装前端依赖
npm install

# 启动 EdgeOne 本地开发（前后端同时启动）
edgeone pages dev
```
