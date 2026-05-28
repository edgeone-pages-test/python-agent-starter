"""
Chat handler -- EdgeOne Makers
========================================

File path agents/chat/index.py maps to **POST /chat**

Uses raw httpx streaming to call the LLM API (OpenAI-compatible chat/completions).
Supports tool calling with EdgeOne platform tools (commands, files, code_interpreter, browser).

Tool calling flow:
  1. Send messages + tools to LLM
  2. LLM returns tool_calls -> execute via EdgeOne sandbox
  3. Send tool results back to LLM
  4. Repeat until LLM gives final text response

context convention:
    context.request.body    -- dict, request body
    context.request.signal  -- asyncio.Event, set when /chat/stop is called
    context.conversation_id -- conversation ID
    context.run_id          -- current run ID
    context.tracer          -- manual instrumentation API (no-op fallback if unavailable)
"""

from typing import Any, AsyncGenerator
import asyncio
import time

import httpx

from .._model import MODEL_CONFIG, ssl_verify
from .._logger import create_logger
from .._session import ChatSession
from .._tools import build_tools, ToolRegistry
from ._stream import LlmRoundResult, sse_event, stream_llm_round, safe_json_preview


logger = create_logger("chat")

SYSTEM_PROMPT = (
    "You are a helpful assistant running inside an EdgeOne sandbox environment.\n"
    "You have access to these EdgeOne platform tools:\n"
    "- commands: execute shell commands in the sandbox (e.g. date, ls, uname, curl).\n"
    "  Parameters: cmd (required, the command to execute), cwd (optional, working directory).\n"
    "- files: file operations in the sandbox — read, write, list, exists, remove, makeDir.\n"
    "  Parameters: op (required), path (required for most ops), content (for write).\n"
    "- code_interpreter: run code in an isolated interpreter.\n"
    "  Parameters: language (e.g. python, javascript, bash), code (source code to execute).\n"
    "- browser: interact with web pages — fetch, screenshot, click, type, evaluate.\n"
    "  Parameters: op (required), url (for fetch), selector, text, script.\n\n"
    "Use tools whenever they help answer the user's question concretely.\n"
    "Call tools ONE AT A TIME. Do NOT simulate or fake tool outputs — actually call the tool.\n"
    "Do NOT use any tools other than those listed above."
)

# Maximum number of tool call rounds to prevent infinite loops
MAX_TOOL_ROUNDS = 10
MAX_MESSAGE_LENGTH = 10000


async def handler(context: Any) -> AsyncGenerator[str, None]:
    """EdgeOne Makers entry point.

    Streams LLM responses with EdgeOne platform tool calling support.
    Instruments key operations via context.tracer for observability.
    """
    cid = context.conversation_id
    logger.log(f"[handler] conversation_id: {cid}")

    body = context.request.body
    message = body.get("message") if isinstance(body, dict) else None

    # ── Tracer: set request-level attributes ──
    context.tracer.set_attributes({
        "agent.scenario": "python_starter_chat",
        "chat.conversation_id": cid,
        "chat.has_message": bool(message),
    })

    if not message:
        yield sse_event("error", {"message": "'message' is required"})
        yield sse_event("done", {})
        return

    if len(message) > MAX_MESSAGE_LENGTH:
        yield sse_event("error", {"message": f"Message too long (max {MAX_MESSAGE_LENGTH} characters)"})
        yield sse_event("done", {})
        return

    # ── Session: load history + save user message ──
    session = ChatSession(context.store)

    session_span = context.tracer.start_span("session.load_and_save", {
        "session.conversation_id": cid,
    })
    try:
        history, _ = await asyncio.gather(
            session.get_history(cid),
            session.save_user_message(cid, message),
        )
        session_span.set_attributes({"session.history_count": len(history)})
    finally:
        session_span.end()

    # ── Tools: build registry from EdgeOne platform tools ──
    tools_span = context.tracer.start_span("tools.build")
    try:
        tool_registry = build_tools(context, logger)
        tools_span.set_attributes({
            "tools.count": len(tool_registry.tools),
            "tools.has_tools": tool_registry.has_tools(),
        })
    finally:
        tools_span.end()

    # Build messages list: system prompt + history + current user message
    messages: list[dict[str, Any]] = (
        [{"role": "system", "content": SYSTEM_PROMPT}]
        + history
        + [{"role": "user", "content": message}]
    )

    # Get platform cancel signal
    cancel_signal = getattr(context.request, "signal", None) or asyncio.Event()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {MODEL_CONFIG['api_key']}",
    }

    base_url = MODEL_CONFIG["base_url"].rstrip("/")
    url = f"{base_url}/chat/completions"

    logger.log(f"[handler] streaming from: {url}, model: {MODEL_CONFIG['model']}, tools: {tool_registry.has_tools()}")

    assistant_content = ""
    cancelled = False

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(300.0, connect=10.0),
            verify=ssl_verify,
            proxy=None,
        ) as client:

            for round_idx in range(MAX_TOOL_ROUNDS):
                if cancel_signal.is_set():
                    cancelled = True
                    break

                # Build payload
                payload: dict[str, Any] = {
                    "model": MODEL_CONFIG["model"],
                    "messages": messages,
                    "stream": True,
                }
                if tool_registry.has_tools():
                    payload["tools"] = tool_registry.tools
                    payload["tool_choice"] = "auto"

                logger.log(f"[handler] round {round_idx + 1}, messages: {len(messages)}")

                # ── Tracer: LLM request span ──
                llm_span = context.tracer.start_span(f"llm.request.round_{round_idx + 1}", {
                    "llm.model": MODEL_CONFIG["model"],
                    "llm.request.message_count": len(messages),
                    "llm.request.tools_included": "tools" in payload,
                    "llm.request.round": round_idx + 1,
                })

                round_result: LlmRoundResult | None = None
                async for item in stream_llm_round(
                    client=client,
                    url=url,
                    payload=payload,
                    headers=headers,
                    cancel_signal=cancel_signal,
                    llm_span=llm_span,
                    logger=logger,
                ):
                    if isinstance(item, str):
                        yield item
                    else:
                        round_result = item

                if round_result is None:
                    break

                if round_result.should_return:
                    return

                round_content = round_result.round_content
                tool_calls = round_result.tool_calls
                assistant_content += round_content

                if round_result.cancelled:
                    cancelled = True
                    break

                if not tool_calls:
                    break

                # Append assistant message with tool_calls to messages
                assistant_msg: dict[str, Any] = {"role": "assistant"}
                if round_content:
                    assistant_msg["content"] = round_content
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"],
                        },
                    }
                    for tc in tool_calls
                ]
                messages.append(assistant_msg)

                # Emit tool_called events and tool_debug call phase
                for tc in tool_calls:
                    yield sse_event("tool_called", {"tool": tc["name"]})
                    yield sse_event("tool_debug", {
                        "phase": "call",
                        "tool": tc["name"],
                        "id": tc["id"],
                        "argumentsPreview": safe_json_preview(tc["arguments"], 1200),
                    })

                # ── Tracer: tool execution spans ──
                tool_spans = []
                for tc in tool_calls:
                    ts = context.tracer.start_span(f"tool.{tc['name']}", {
                        "tool.name": tc["name"],
                        "tool.call_id": tc["id"],
                        "tool.arguments_length": len(tc["arguments"]),
                    })
                    tool_spans.append(ts)

                try:
                    results = []
                    for tc_item in tool_calls:
                        started_at = time.perf_counter()
                        result = await tool_registry.execute(tc_item["name"], tc_item["arguments"])
                        duration_ms = int((time.perf_counter() - started_at) * 1000)
                        results.append(result)
                        yield sse_event("tool_debug", {
                            "phase": "result",
                            "tool": tc_item["name"],
                            "id": tc_item["id"],
                            "resultPreview": safe_json_preview(result, 2000),
                            "resultLength": len(result),
                            "durationMs": duration_ms,
                        })
                    for ts, result in zip(tool_spans, results):
                        ts.set_attributes({"tool.result_length": len(result)})
                finally:
                    for ts in tool_spans:
                        ts.end()

                for tc, tool_result in zip(tool_calls, results):
                    logger.log(f"[tool] {tc['name']}: {tool_result[:200]}")
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "content": tool_result,
                    })

    except (httpx.HTTPError, httpx.StreamError) as e:
        logger.error(f"[handler] httpx error: {type(e).__name__}: {e}")
        context.tracer.set_attributes({
            "error.type": type(e).__name__,
            "error.message": str(e),
        })
        yield sse_event("error", {"message": "LLM service request failed, please try again later"})
    except Exception as e:
        logger.error(f"[handler] unexpected error: {type(e).__name__}: {e}")
        context.tracer.set_attributes({
            "error.type": type(e).__name__,
            "error.message": str(e),
        })
        yield sse_event("error", {"message": "Internal server error"})

    # ── Tracer: save assistant response ──
    if assistant_content:
        save_span = context.tracer.start_span("session.save_assistant_message", {
            "session.conversation_id": cid,
            "session.content_length": len(assistant_content),
        })
        try:
            await session.save_assistant_message(cid, assistant_content)
        finally:
            save_span.end()

    yield sse_event("done", {"stopped": cancelled})
