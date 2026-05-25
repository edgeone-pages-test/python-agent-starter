"""
Tools module -- private module (starts with _), not mapped as a route.

Extracts EdgeOne platform tools from context.tools and converts them to
OpenAI-compatible function calling format for the chat/completions API.

EdgeOne provides sandbox tools: commands, files, code_interpreter, browser.
"""

from __future__ import annotations

import inspect
import json
from typing import Any


TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "commands": {
        "type": "function",
        "function": {
            "name": "commands",
            "description": "Execute a shell command in the EdgeOne sandbox environment",
            "parameters": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string", "description": "Shell command to execute"},
                    "cwd": {"type": "string", "description": "Working directory (optional)"},
                },
                "required": ["cmd"],
            },
        },
    },
    "files": {
        "type": "function",
        "function": {
            "name": "files",
            "description": "Perform file operations in the EdgeOne sandbox: read, write, list, exists, remove, makeDir",
            "parameters": {
                "type": "object",
                "properties": {
                    "op": {
                        "type": "string",
                        "enum": ["read", "write", "list", "exists", "remove", "makeDir"],
                        "description": "File operation to perform",
                    },
                    "path": {"type": "string", "description": "File or directory path"},
                    "content": {"type": "string", "description": "Content for write operation"},
                },
                "required": ["op", "path"],
            },
        },
    },
    "code_interpreter": {
        "type": "function",
        "function": {
            "name": "code_interpreter",
            "description": "Run code in an isolated interpreter in the EdgeOne sandbox",
            "parameters": {
                "type": "object",
                "properties": {
                    "language": {
                        "type": "string",
                        "enum": ["python", "javascript", "r", "bash"],
                        "description": "Programming language to execute",
                    },
                    "code": {"type": "string", "description": "Source code to execute"},
                },
                "required": ["language", "code"],
            },
        },
    },
    "browser": {
        "type": "function",
        "function": {
            "name": "browser",
            "description": "Interact with web pages in the EdgeOne sandbox: fetch, screenshot, click, type, evaluate",
            "parameters": {
                "type": "object",
                "properties": {
                    "op": {
                        "type": "string",
                        "enum": ["fetch", "screenshot", "click", "type", "evaluate"],
                        "description": "Browser operation to perform",
                    },
                    "url": {"type": "string", "description": "Target URL (for fetch)"},
                    "selector": {"type": "string", "description": "CSS selector"},
                    "text": {"type": "string", "description": "Text to type"},
                    "script": {"type": "string", "description": "JavaScript to evaluate"},
                },
                "required": ["op"],
            },
        },
    },
}


class ToolRegistry:
    """Registry holding tool schemas and handlers extracted from context.tools."""

    def __init__(self) -> None:
        self.tools: list[dict[str, Any]] = []
        self._handlers: dict[str, Any] = {}
        self._use_kwargs: dict[str, bool] = {}  # cached call style per tool

    def has_tools(self) -> bool:
        return len(self.tools) > 0

    def register(self, name: str, schema: dict[str, Any], handler: Any) -> None:
        """Register a tool with its schema and handler."""
        self.tools.append(schema)
        self._handlers[name] = handler
        self._use_kwargs[name] = _should_call_with_kwargs(handler)

    async def execute(self, name: str, arguments: str) -> str:
        """Execute a tool by name with JSON string arguments."""
        handler = self._handlers.get(name)
        if handler is None:
            return json.dumps({"error": f"Unknown tool: {name}"}, ensure_ascii=False)

        try:
            args = json.loads(arguments) if arguments else {}
        except json.JSONDecodeError as e:
            return json.dumps({"error": f"Invalid arguments JSON: {str(e)}"}, ensure_ascii=False)

        try:
            if self._use_kwargs.get(name, False):
                result = handler(**args)
            else:
                result = handler(args)

            if inspect.isawaitable(result):
                result = await result

            return _stringify_result(result)
        except Exception as e:
            return json.dumps({"error": f"Tool execution failed: {str(e)}"}, ensure_ascii=False)


def build_tools(context: Any, logger: Any = None) -> ToolRegistry:
    """Build a ToolRegistry from EdgeOne's context.tools."""
    registry = ToolRegistry()

    runtime_tools = getattr(context, "tools", None)
    if logger:
        logger.log(f"[tools] context.tools = {runtime_tools}")
        logger.log(f"[tools] context.tools type = {type(runtime_tools)}")
        logger.log(f"[tools] context dir = {[a for a in dir(context) if not a.startswith('__')]}")

    if runtime_tools is None or not hasattr(runtime_tools, "all"):
        if logger:
            logger.log(f"[tools] no EdgeOne platform tools available (runtime_tools={runtime_tools}, has 'all'={hasattr(runtime_tools, 'all') if runtime_tools else 'N/A'})")
        return registry

    raw_tools = runtime_tools.all()
    if inspect.isawaitable(raw_tools):
        raise RuntimeError("context.tools.all() returned an awaitable; expected a list")

    if logger:
        logger.log(f"[tools] raw_tools from runtime: {raw_tools}")
        logger.log(f"[tools] raw_tools count: {len(raw_tools) if raw_tools else 0}")

    for item in raw_tools or []:
        name = _attr(item, "name") or _nested_attr(item, "function", "name")
        schema = TOOL_SCHEMAS.get(name or "")
        handler = _attr(item, "execute") or _attr(item, "handler") or _attr(item, "invoke")

        if logger:
            logger.log(f"[tools] inspecting item: name={name}, has_schema={schema is not None}, handler={handler is not None}")

        if not name or schema is None or not callable(handler):
            if logger:
                logger.log(f"[tools] skipped unsupported platform tool: {name or '<unknown>'} (name={bool(name)}, schema={bool(schema)}, callable={callable(handler) if handler else False})")
            continue

        registry.register(name, schema, handler)
        if logger:
            logger.log(f"[tools] registered: {name}")

    return registry


def _attr(item: Any, key: str) -> Any:
    """Unified accessor for dict or object attribute."""
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def _nested_attr(item: Any, outer: str, inner: str) -> Any:
    """Access item.outer.inner (works for both dict and object)."""
    func = _attr(item, outer)
    if func is None:
        return None
    return _attr(func, inner)


def _should_call_with_kwargs(fn: Any) -> bool:
    """Determine if function should be called with **kwargs vs positional dict.
    Result is cached at registration time to avoid per-call reflection."""
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return False

    params = list(sig.parameters.values())
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params):
        return True

    required = [
        p.name
        for p in params
        if p.default is inspect.Parameter.empty
        and p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
    ]
    if required and len(required) > 1:
        return True

    try:
        sig.bind({})
        return False
    except TypeError:
        pass

    try:
        sig.bind(**{})
        return True
    except TypeError:
        return False


def _stringify_result(result: Any) -> str:
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return str(result)
