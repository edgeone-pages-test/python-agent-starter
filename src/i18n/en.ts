const en = {
  // Header
  "app.title": "Python Starter",
  "app.subtitle": "Python Starter -- EdgeOne Makers + Platform Tools",

  // Empty state
  "empty.title": "Python Starter",
  "empty.hint": "I'm an Agent running on EdgeOne, using raw httpx streaming for chat and tool calling loops. Supports commands, files, code_interpreter, and browser sandbox tools.",
  "empty.features": "EdgeOne Store · Session Memory · Platform Tools",

  // Chat input
  "chat.placeholder": "Send a message... Enter to send, Shift+Enter for newline",
  "chat.hint": "Raw fetch + tool loop · EdgeOne Platform Tools",

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
  "status.stopped": " *Generation stopped*",
  "status.backendError": "Backend abort request failed. The server may still be running.",

  // Language toggle
  "lang.switch": "中文",

  // Trace panel
  "trace.title": "Trace",
  "trace.events": "events",
  "trace.clear": "Clear",
  "trace.empty": "Waiting for SSE events...",
  "trace.emptyHint": "After sending a message, raw backend SSE data will be displayed here.",

  // ─── REPL UI ─────────────────────────────────────────────────────────
  "repl.motd.title": "Python LLM Agent · EdgeOne Pages Functions",
  "repl.motd.tools": "Tools available: commands  files  code_interpreter  browser",
  "repl.motd.help": "Type a question and press Enter. Ctrl+C aborts. Ctrl+L clears. Ctrl+T toggles trace. Ctrl+/ shows help.",
  "repl.prompt.label": "user▸ ",
  "repl.prompt.userLabel": "user▸ ",
  "repl.prompt.agentLabel": "agent▸ ",
  "repl.prompt.placeholder": "ask anything…",
  "repl.status.idle": "idle",
  "repl.status.running": "running",
  "repl.status.aborted": "^C  aborted (frontend)",
  "repl.status.stopOk": "backend stop ack",
  "repl.status.stopFail": "backend stop FAILED",
  "repl.status.cleared": "[cleared · server history kept]",
  "repl.status.reset": "[session reset · new conversation_id]",
  "repl.status.restored": "restored",
  "repl.status.restoring": "… restoring conversation {id} ({n} messages) …",
  "repl.status.restoringFallback": "… restoring conversation …",
  "repl.status.verboseOn": "[verbose: raw SSE events]",
  "repl.status.verboseOff": "[verbose: off]",
  "repl.done.summary": "[done · {elapsed}s · {rounds} tool rounds]",
  "repl.help.title": "commands & shortcuts",
  "repl.help.body": "Enter — submit · Shift+Enter — newline · ↑/↓ — input history · Ctrl+C — abort/clear · Ctrl+L — clear screen · Ctrl+Shift+K — reset session · Ctrl+T — toggle trace · Ctrl+/ — this help",

  // ─── Image (tool output) ─────────────────────────────────────────────
  "repl.image.open": "Open image (Esc to close)",

  // ─── Pending caret (between submit and first agent output) ───────────
  "repl.status.thinking": "thinking…",

  // ─── Aria labels ─────────────────────────────────────────────────────
  "aria.closeImagePreview": "Close image preview",
} as const;

export default en;
