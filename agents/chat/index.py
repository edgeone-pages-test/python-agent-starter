"""
Chat handler -- EdgeOne Pages Functions
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
import json

import httpx

from .._model import MODEL_CONFIG, ssl_verify
from .._logger import create_logger
from .._session import ChatSession
from .._tools import build_tools, ToolRegistry


logger = create_logger("chat")

SYSTEM_PROMPT = (
    "你是一个运行在 EdgeOne 沙箱环境中的助手。\n"
    "你可以使用以下 EdgeOne 平台工具：\n"
    "- commands: 在沙箱中执行 shell 命令（例如 date、ls、uname、curl 等）。\n"
    "  参数：cmd（必填，要执行的命令），cwd（可选，工作目录）。\n"
    "- files: 在沙箱中进行文件操作，包括 read、write、list、exists、remove、makeDir。\n"
    "  参数：op（必填，操作类型），path（多数操作必填，文件或目录路径），content（write 时使用）。\n"
    "- code_interpreter: 在隔离解释器中运行代码。\n"
    "  参数：language（例如 python、javascript、bash），code（要执行的源码）。\n"
    "- browser: 与网页交互，包括 fetch、screenshot、click、type、evaluate。\n"
    "  参数：op（必填，操作类型），url（fetch 使用），selector、text、script。\n\n"
    "当工具能够帮助你更具体、准确地回答用户问题时，请主动使用工具。\n"
    "一次只调用一个工具。不要模拟或伪造工具输出，必须实际调用工具获取结果。\n"
    "不要使用上述列表之外的任何工具。"
)

# Maximum number of tool call rounds to prevent infinite loops
MAX_TOOL_ROUNDS = 10
MAX_MESSAGE_LENGTH = 10000


def sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def handler(context: Any) -> AsyncGenerator[str, None]:
    """EdgeOne Pages Functions entry point.

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
        yield sse_event("error", {"message": f"消息长度超过限制 ({MAX_MESSAGE_LENGTH} 字符)"})
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

                # Stream and collect the response
                round_content = ""
                tool_calls: list[dict[str, Any]] = []

                try:
                    async with client.stream("POST", url, json=payload, headers=headers) as response:
                        if response.status_code != 200:
                            error_body = await response.aread()
                            logger.error(f"[handler] LLM API error: {response.status_code} {error_body.decode()}")
                            llm_span.set_attributes({
                                "http.status_code": response.status_code,
                                "llm.error": True,
                            })
                            yield sse_event("error", {"message": f"LLM API error: {response.status_code}"})
                            yield sse_event("done", {})
                            return

                        llm_span.set_attributes({"http.status_code": 200})

                        async for content_delta, tc_list in _parse_stream_with_tools(response, cancel_signal):
                            if cancel_signal.is_set():
                                cancelled = True
                                break

                            if content_delta:
                                round_content += content_delta
                                assistant_content += content_delta
                                yield sse_event("text_delta", {"delta": content_delta})

                            if tc_list is not None:
                                tool_calls = tc_list
                finally:
                    llm_span.set_attributes({
                        "llm.response.content_length": len(round_content),
                        "llm.response.has_tool_calls": bool(tool_calls),
                    })
                    llm_span.end()

                if cancelled:
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

                # Emit tool_called events
                for tc in tool_calls:
                    yield sse_event("tool_called", {"tool": tc["name"]})

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
                    results = await asyncio.gather(
                        *(tool_registry.execute(tc["name"], tc["arguments"]) for tc in tool_calls)
                    )
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
        context.tracer.record_exception(e)
        yield sse_event("error", {"message": "LLM 服务请求失败，请稍后重试"})
    except Exception as e:
        logger.error(f"[handler] unexpected error: {type(e).__name__}: {e}")
        context.tracer.record_exception(e)
        yield sse_event("error", {"message": "服务内部错误"})

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


async def _parse_stream_with_tools(
    response: httpx.Response,
    cancel_signal: asyncio.Event,
) -> AsyncGenerator[tuple[str, list[dict[str, Any]] | None], None]:
    """Parse SSE stream from OpenAI-compatible API, handling both content and tool_calls.

    Yields tuples of (content_delta, tool_calls):
      - (content_delta, None): a text chunk to stream to the user
      - ("", [...]):           final accumulated tool_calls (yielded once at the end)

    Tool calls are accumulated across streaming chunks because the API sends
    arguments incrementally across multiple chunks.
    """
    # Accumulator for tool calls: index -> {id, name, arguments}
    tool_calls_acc: dict[int, dict[str, str]] = {}
    finish_reason = None

    async for line in response.aiter_lines():
        if cancel_signal.is_set():
            break

        line = line.strip()
        if not line:
            continue
        if line == "data: [DONE]":
            break
        if not line.startswith("data: "):
            continue

        json_str = line[6:]
        try:
            chunk = json.loads(json_str)
        except json.JSONDecodeError:
            continue

        choices = chunk.get("choices", [])
        if not choices:
            continue

        choice = choices[0]
        delta = choice.get("delta", {})
        choice_finish = choice.get("finish_reason")
        if choice_finish:
            finish_reason = choice_finish

        # Handle text content
        content = delta.get("content")
        if content:
            yield (content, None)

        # Handle tool calls (accumulated across chunks)
        delta_tool_calls = delta.get("tool_calls")
        if delta_tool_calls:
            for tc_delta in delta_tool_calls:
                idx = tc_delta.get("index", 0)

                if idx not in tool_calls_acc:
                    tool_calls_acc[idx] = {
                        "id": tc_delta.get("id", ""),
                        "name": "",
                        "arguments": "",
                    }

                tc = tool_calls_acc[idx]

                # id only comes in the first chunk for each tool call
                if tc_delta.get("id"):
                    tc["id"] = tc_delta["id"]

                # function.name only comes in the first chunk
                func = tc_delta.get("function", {})
                if func.get("name"):
                    tc["name"] = func["name"]

                # function.arguments is streamed incrementally
                if func.get("arguments"):
                    tc["arguments"] += func["arguments"]

    # After stream ends, yield accumulated tool_calls if any
    if tool_calls_acc and finish_reason == "tool_calls":
        sorted_calls = [tool_calls_acc[i] for i in sorted(tool_calls_acc.keys())]
        yield ("", sorted_calls)
