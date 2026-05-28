const zh = {
  // Header
  "app.title": "Python Starter",
  "app.subtitle": "基于 EdgeOne Makers 运行，支持会话记忆和沙箱工具",

  // Empty state
  "empty.title": "Python Starter",
  "empty.hint": "我是运行在 EdgeOne 上的 Python Agent，支持沙箱工具调用和会话记忆。我可以帮助你运行命令、管理文件、执行代码和浏览网页。",
  "empty.features": "EdgeOne Store · 会话记忆 · 平台工具",

  // Chat input
  "chat.placeholder": "输入消息...  ⏎ 发送 · Shift+⏎ 换行",
  "chat.hint": "由 Python + httpx 驱动 · 仅供演示",

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
  "status.stopped": "⏹ *已停止生成*",
  "status.backendError": "后端中止请求失败，服务器可能仍在运行。",

  // Trace panel
  "trace.title": "Trace",
  "trace.events": "事件",
  "trace.clear": "清除",
  "trace.empty": "等待 SSE 事件...",
  "trace.emptyHint": "发送消息后，原始后端 SSE 数据会显示在这里。",

  // Language toggle
  "lang.switch": "English",
} as const;

export default zh;
