"""
Tools module -- private module (starts with _), not mapped as a route.

Extracts EdgeOne platform tools from context.tools and passes them through
directly to the chat/completions API.

EdgeOne provides sandbox tools: commands, files, code_interpreter, browser.
"""

from __future__ import annotations

import inspect
import json
from typing import Any


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
        if name in self._handlers:
            return
        self.tools.append(schema)
        self._handlers[name] = handler
        self._use_kwargs[name] = _should_call_with_kwargs(handler)

    async def execute(self, name: str, arguments: str) -> str:
        """Execute a tool by name with JSON string arguments. Returns a string
        suitable for stuffing into a `role: 'tool'` message.

        Implementation: thin wrapper over execute_raw + _stringify_result. Kept
        as a separate convenience entry so existing callers don't need to
        change shape; new image-extraction code in chat/index.py uses
        execute_raw directly so it can sniff for base64 BEFORE serialization.
        """
        raw = await self.execute_raw(name, arguments)
        return _stringify_result(raw)

    async def execute_raw(self, name: str, arguments: str) -> Any:
        """Like `execute` but returns the handler's RAW value (or a structured
        error dict) without serialization.

        Why: lets callers inspect the result for embedded base64 images BEFORE
        stringification, so images can be lifted out of the tool message
        before it ever flows into the next chat-completions round (where
        multi-MB base64 strings would otherwise burn tokens and break the
        context window).
        """
        handler = self._handlers.get(name)
        if handler is None:
            return {"error": f"Unknown tool: {name}"}

        try:
            args = json.loads(arguments) if arguments else {}
        except json.JSONDecodeError:
            args = {}

        try:
            if self._use_kwargs.get(name, False):
                result = handler(**args)
            else:
                result = handler(args)

            if inspect.isawaitable(result):
                result = await result

            return result
        except Exception as e:
            return {"error": f"Tool execution failed: {str(e)}"}


def build_tools(context: Any, logger: Any = None) -> ToolRegistry:
    """Build a ToolRegistry from EdgeOne's context.tools.

    Schemas are taken directly from the platform-provided tool items rather than
    hardcoded, so any tool exposed by the EdgeOne runtime is supported.
    """
    registry = ToolRegistry()

    runtime_tools = context.tools
    if logger:
        logger.log(f"[tools] context.tools = {runtime_tools}")
        logger.log(f"[tools] context.tools type = {type(runtime_tools)}")

    if not hasattr(runtime_tools, "all"):
        if logger:
            logger.log("[tools] no EdgeOne platform tools available")
        return registry

    raw_tools = runtime_tools.all()
    if inspect.isawaitable(raw_tools):
        raise RuntimeError("context.tools.all() returned an awaitable; expected a list")

    if logger:
        logger.log(f"[tools] raw_tools count: {len(raw_tools) if raw_tools else 0}")

    for item in raw_tools or []:
        name = _attr(item, "name") or _nested_attr(item, "function", "name")
        handler = _attr(item, "execute") or _attr(item, "handler") or _attr(item, "invoke")

        if logger:
            logger.log(f"[tools] inspecting: name={name}, callable={callable(handler)}")

        if not name or not callable(handler):
            if logger:
                logger.log(f"[tools] skipped: {name or '<unknown>'}")
            continue

        schema = _build_schema(item, name)
        registry.register(name, schema, handler)
        if logger:
            logger.log(f"[tools] registered: {name}")

    return registry


def _build_schema(item: Any, name: str) -> dict[str, Any]:
    """Build a clean OpenAI function-tool schema from a runtime tool item.

    Returns ONLY {type: 'function', function: {name, description, parameters}}.
    EdgeOne tool items carry extra fields (execute, inputSchema, type='tool',
    raw runtime metadata, etc.) that strict upstream gateways may reject —
    causing the entire `tools` array to be silently ignored and the model to
    answer without ever calling a tool. Keeping the schema minimal avoids that.
    """
    function_block_raw = _attr(item, "function")
    if function_block_raw is not None:
        fb = _json_safe(_to_dict(function_block_raw))
        description = fb.get("description", "") or _attr(item, "description") or ""
        parameters = fb.get("parameters") or {"type": "object", "properties": {}}
    else:
        description = _attr(item, "description") or ""
        parameters_raw = (
            _attr(item, "parameters")
            or _attr(item, "inputSchema")
            or _attr(item, "input_schema")
            or {"type": "object", "properties": {}}
        )
        parameters = _json_safe(parameters_raw if isinstance(parameters_raw, dict) else _to_dict(parameters_raw))

    if not isinstance(parameters, dict) or not parameters:
        parameters = {"type": "object", "properties": {}}

    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


def _to_dict(value: Any) -> dict[str, Any]:
    """Best-effort conversion of an item (dict or object) to a plain dict."""
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if hasattr(value, "__dict__"):
        return {k: v for k, v in vars(value).items() if not k.startswith("_")}
    return {}


def _json_safe(value: Any) -> Any:
    """Recursively strip callables and other non-JSON-serializable values.

    Keeps primitives, lists, and dicts; drops keys whose value is a callable
    (e.g. `execute`/`handler`/`invoke`) so the schema can be sent to the LLM
    API without `TypeError: Object of type function is not JSON serializable`.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {
            k: _json_safe(v)
            for k, v in value.items()
            if not callable(v) and not (isinstance(k, str) and k.startswith("_"))
        }
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value if not callable(v)]
    if callable(value):
        return None
    if hasattr(value, "__dict__"):
        return _json_safe(_to_dict(value))
    # Fallback: attempt JSON round-trip; if it fails, drop by stringifying.
    try:
        json.dumps(value)
        return value
    except (TypeError, ValueError):
        return str(value)


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
