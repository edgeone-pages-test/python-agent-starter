const en = {
  // Header
  "app.title": "Python Starter",
  "app.subtitle": "Running on EdgeOne Makers with session memory and sandbox tools",

  // Empty state
  "empty.title": "Python Starter",
  "empty.hint": "I'm a Python Agent running on EdgeOne, with sandbox tool calling and session memory. I can help you run commands, manage files, execute code, and browse the web.",
  "empty.features": "EdgeOne Store · Session Memory · Platform Tools",

  // Chat input
  "chat.placeholder": "Type a message...  ⏎ Send · Shift+⏎ Newline",
  "chat.hint": "Powered by Python + httpx · Demo only",

  // Preset questions
  "preset.1": "Use terminal commands to check the current system time and OS info",
  "preset.2": "Create a hello.txt file in the sandbox with content \"Hello EdgeOne!\", then read it back",
  "preset.3": "Use Python to calculate and print the first 20 Fibonacci numbers",
  "preset.4": "Use the browser to fetch the page title of https://edgeone.ai",

  // Tool indicators
  "tool.commands": "Commands",
  "tool.files": "Files",
  "tool.codeRunner": "Code Runner",
  "tool.browser": "Browser",

  // Status & errors
  "status.error": "Request failed. Please check if the backend service is running.",
  "status.stopped": "⏹ *Generation stopped*",
  "status.backendError": "Backend abort request failed. The server may still be running.",

  // Trace panel
  "trace.title": "Trace",
  "trace.events": "events",
  "trace.clear": "Clear",
  "trace.empty": "Waiting for SSE events...",
  "trace.emptyHint": "After sending a message, raw backend SSE data will be displayed here.",

  // Language toggle
  "lang.switch": "中文",
} as const;

export default en;
