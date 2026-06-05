const zh = {
  // Header
  "app.title": "Python Starter",
  "app.subtitle": "Python Starter -- EdgeOne Makers + 平台工具",

  // Empty state
  "empty.title": "Python Starter",
  "empty.hint": "我是运行在 EdgeOne 上的 Agent，使用原生 httpx 流式实现聊天和工具调用循环。支持命令行、文件、代码解释器和浏览器沙箱工具。",
  "empty.features": "EdgeOne Store · 会话记忆 · 平台工具",

  // Chat input
  "chat.placeholder": "输入消息... Enter 发送，Shift+Enter 换行",
  "chat.hint": "原生 fetch + 工具循环 · EdgeOne 平台工具",

  // Preset questions
  "preset.1": "使用终端命令检查当前系统时间和操作系统信息",
  "preset.2": "在沙箱中创建 hello.txt 文件，内容为 \"Hello EdgeOne!\"，然后读取它",
  "preset.3": "使用 Python 计算并打印前 20 个斐波那契数",
  "preset.4": "使用浏览器获取 https://edgeone.ai 的页面标题",

  // Tool indicators
  "tool.commands": "命令行",
  "tool.files": "文件",
  "tool.codeRunner": "代码运行",
  "tool.browser": "浏览器",

  // Status & errors
  "status.error": "请求失败，请检查后端服务是否正常运行。",
  "status.stopped": " *已停止生成*",
  "status.backendError": "后端中止请求失败，服务器可能仍在运行。",

  // Language toggle
  "lang.switch": "English",

  // Trace panel
  "trace.title": "Trace",
  "trace.events": "事件",
  "trace.clear": "清除",
  "trace.empty": "等待 SSE 事件...",
  "trace.emptyHint": "发送消息后，原始后端 SSE 数据会显示在这里。",

  // ─── REPL UI ─────────────────────────────────────────────────────────
  "repl.motd.title": "Python Starter",
  "repl.motd.tools": "可用工具：commands  files  code_interpreter  browser",
  "repl.motd.help": "输入问题并按回车提交。Ctrl+C 中止 · Ctrl+L 清屏 · Ctrl+T 切换 trace · Ctrl+/ 显示帮助。",
  "repl.prompt.label": "user▸ ",
  "repl.prompt.userLabel": "user▸ ",
  "repl.prompt.agentLabel": "agent▸ ",
  "repl.prompt.placeholder": "随便问点什么…",
  "repl.status.idle": "空闲",
  "repl.status.running": "运行中",
  "repl.status.aborted": "^C  已中止（前端）",
  "repl.status.stopOk": "后端已确认 stop",
  "repl.status.stopFail": "后端 stop 失败",
  "repl.status.cleared": "[已清屏 · 服务端历史保留]",
  "repl.status.reset": "[会话已重置 · 新 conversation_id]",
  "repl.status.restored": "已恢复",
  "repl.status.restoring": "… 正在恢复会话 {id}（{n} 条消息）…",
  "repl.status.restoringFallback": "… 正在恢复会话 …",
  "repl.status.verboseOn": "[verbose：显示原始 SSE 事件]",
  "repl.status.verboseOff": "[verbose：关闭]",
  "repl.done.summary": "[完成 · {elapsed}s · {rounds} 轮工具调用]",
  "repl.help.title": "命令与快捷键",
  "repl.help.body": "Enter — 提交 · Shift+Enter — 换行 · ↑/↓ — 输入历史 · Ctrl+C — 中止/清空 · Ctrl+L — 清屏 · Ctrl+Shift+K — 重置会话 · Ctrl+T — 切换 trace · Ctrl+/ — 此帮助",

  // ─── Image (tool output) ─────────────────────────────────────────────
  "repl.image.open": "打开图片（Esc 关闭）",

  // ─── Pending caret (between submit and first agent output) ───────────
  "repl.status.thinking": "思考中…",

  // ─── Aria labels ─────────────────────────────────────────────────────
  "aria.closeImagePreview": "关闭图片预览",
} as const;

export default zh;
