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
from .._tools import build_tools, ToolRegistry, _stringify_result
from ._stream import LlmRoundResult, sse_event, stream_llm_round, safe_json_preview
from ._images import extract_images_from_tool_result


logger = create_logger("chat")

SYSTEM_PROMPT = (
    "You are an EdgeOne Makers Python starter example: an out-of-the-box Agent template that helps developers quickly run through and validate platform capabilities. This template shows how to call an OpenAI-compatible Chat Completions API directly with raw `httpx`, no agent SDK.\n"
    "When introducing yourself, clearly say that you are a demo Agent built with raw Python (no SDK, just OpenAI-compatible httpx + function calling) on EdgeOne Makers, designed to showcase tool calling, streaming responses, and session memory for developers.\n"
    "The runtime exposes a set of platform tools via function calling — their exact\n"
    "names, descriptions, and parameter schemas are provided alongside this message.\n"
    "Read each tool's schema before calling it; do not assume names or parameters.\n\n"
    "Tool families you may see (the runtime may expose multiple fine-grained tools per family,\n"
    "e.g. `browser_fetch`, `files_read`, `commands_run`, `code_interpreter_python`):\n"
    "- commands / shell: execute shell commands in the sandbox (e.g. date, ls, uname, curl).\n"
    "- files / fs: read, write, list, check, remove, or create files and directories.\n"
    "- code_interpreter / interpreter: run code in an isolated interpreter (python, javascript, bash, ...).\n"
    "- browser: fetch web pages, take screenshots, click, type, evaluate scripts.\n\n"
    "Tool-use rules:\n"
    "1. Use a tool only when it is necessary to answer the user concretely.\n"
    "2. Call tools one at a time and wait for each result before deciding the next step.\n"
    "3. Never invent, simulate, or paraphrase tool results. If a tool result is unavailable, say so.\n"
    "4. If a tool call fails, do not repeat it blindly and do not switch to unrelated operations.\n"
    "   Briefly explain the failure, adjust the parameters only if the fix is clear, otherwise ask the user for guidance.\n"
    "5. Do not perform destructive file or shell operations unless the user explicitly asks for them.\n"
    "6. If the task can be answered without tools, answer directly and keep the response concise.\n"
    "Only call tools that appear in the function-calling schema provided to you."
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
    cancel_signal = context.request.signal

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
                    "stream_options": {"include_usage": True},
                }
                if tool_registry.has_tools():
                    payload["tools"] = tool_registry.tools
                    payload["tool_choice"] = "auto"

                logger.log(f"[handler] round {round_idx + 1}, messages: {len(messages)}")

                # ── Tracer: LLM request span ──
                llm_span = context.tracer.start_span(f"llm.request.round_{round_idx + 1}", {
                    "openinference.span.kind": "LLM",
                    "llm.model_name": MODEL_CONFIG["model"],
                    "llm.provider": "openai",
                    "llm.request.type": "chat",
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

                        # Pull the RAW handler value so we can sniff for base64
                        # images BEFORE serialization. Anything we find is
                        # replaced with a `[image:<id>]` placeholder; the
                        # redacted structure is what flows back into the
                        # model context (next chat-completions round).
                        raw = await tool_registry.execute_raw(
                            tc_item["name"], tc_item["arguments"]
                        )
                        extraction = extract_images_from_tool_result(raw)
                        result = _stringify_result(extraction.redacted_result)
                        duration_ms = int((time.perf_counter() - started_at) * 1000)
                        results.append(result)

                        # SSE ordering contract: image events fire AFTER
                        # tool_debug{phase:'call'} (already emitted at line
                        # ~233 above) and BEFORE tool_debug{phase:'result'}.
                        # The frontend uses this to attach images to the
                        # in-flight tool row.
                        for img in extraction.images:
                            yield sse_event("image", {
                                "imageId": img.image_id,
                                "base64": img.base64,
                                "mimeType": img.mime_type,
                                "size": img.size,
                                "toolName": tc_item["name"],
                                "toolCallId": tc_item["id"],
                            })

                        debug_payload: dict[str, Any] = {
                            "phase": "result",
                            "tool": tc_item["name"],
                            "id": tc_item["id"],
                            "resultPreview": safe_json_preview(result, 2000),
                            "resultLength": len(result),
                            "durationMs": duration_ms,
                            "imageCount": len(extraction.images),
                        }
                        if extraction.truncated:
                            debug_payload["imagesTruncated"] = True
                        yield sse_event("tool_debug", debug_payload)
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
        yield sse_event("error", {
            "message": "LLM service request failed, please try again later",
            "errorType": type(e).__name__,
            "detail": str(e),
        })
    except Exception as e:
        logger.error(f"[handler] unexpected error: {type(e).__name__}: {e}")
        context.tracer.set_attributes({
            "error.type": type(e).__name__,
            "error.message": str(e),
        })
        yield sse_event("error", {
            "message": "Internal server error",
            "errorType": type(e).__name__,
            "detail": str(e),
        })

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
