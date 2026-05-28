"""SSE helpers for the chat endpoint."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, AsyncGenerator
import asyncio
import json
import re

import httpx


_BASE64_IMAGE_RE = re.compile(r'"base64Image"\s*:\s*"[A-Za-z0-9+/=]{100,}"')


def redact_base64_image(text: str) -> str:
    """Replace base64Image values with a redacted placeholder."""
    return _BASE64_IMAGE_RE.sub('"base64Image":"[REDACTED image data]"', text)


def safe_json_preview(value: Any, max_length: int = 1200) -> str:
    """Return a safe, truncated string preview of a value.

    - Serializes non-string values to JSON
    - Redacts base64 image data
    - Truncates to max_length
    """
    try:
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        text = str(value)
    redacted = redact_base64_image(text or "")
    return redacted if len(redacted) <= max_length else f"{redacted[:max_length]}...<truncated>"


@dataclass
class LlmRoundResult:
    """Final state of one streamed LLM round."""

    round_content: str
    tool_calls: list[dict[str, Any]]
    cancelled: bool = False
    should_return: bool = False


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def parse_stream_with_tools(
    response: httpx.Response,
    cancel_signal: asyncio.Event,
) -> AsyncGenerator[tuple[str, list[dict[str, Any]] | None, dict[str, int] | None], None]:
    """Parse OpenAI-compatible SSE stream and accumulate tool calls.

    Yields tuples of (content_delta, tool_calls, usage):
      - (content_delta, None, None): a text chunk to stream to the user
      - ("", [...], usage): final accumulated tool_calls + usage, yielded once at the end
      - ("", None, usage): usage only (no tool calls), yielded at the end

    Tool calls are accumulated across streaming chunks because the API sends
    function call arguments incrementally.
    """
    tool_calls_acc: dict[int, dict[str, str]] = {}
    finish_reason = None
    usage: dict[str, int] | None = None

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

        # Capture usage from the final chunk
        if chunk.get("usage"):
            usage = chunk["usage"]

        choices = chunk.get("choices", [])
        if not choices:
            continue

        choice = choices[0]
        delta = choice.get("delta", {})
        choice_finish = choice.get("finish_reason")
        if choice_finish:
            finish_reason = choice_finish

        content = delta.get("content")
        if content:
            yield (content, None, None)

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

                # id only comes in the first chunk for each tool call.
                if tc_delta.get("id"):
                    tc["id"] = tc_delta["id"]

                # function.name only comes in the first chunk.
                func = tc_delta.get("function", {})
                if func.get("name"):
                    tc["name"] = func["name"]

                # function.arguments is streamed incrementally.
                if func.get("arguments"):
                    tc["arguments"] += func["arguments"]

    if tool_calls_acc and finish_reason == "tool_calls":
        sorted_calls = [tool_calls_acc[i] for i in sorted(tool_calls_acc.keys())]
        yield ("", sorted_calls, usage)
    elif usage:
        yield ("", None, usage)


async def stream_llm_round(
    client: httpx.AsyncClient,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    cancel_signal: asyncio.Event,
    llm_span: Any,
    logger: Any,
) -> AsyncGenerator[str | LlmRoundResult, None]:
    """Stream one LLM round and emit frontend SSE frames.

    Yields SSE strings while streaming. The final yield is an LlmRoundResult
    containing accumulated content/tool calls and cancellation state.
    """
    round_content = ""
    tool_calls: list[dict[str, Any]] = []
    cancelled = False

    try:
        async with client.stream("POST", url, json=payload, headers=headers) as response:
            if response.status_code != 200:
                error_body = await response.aread()
                logger.error(
                    f"[handler] LLM API error: {response.status_code} {error_body.decode()}"
                )
                llm_span.set_attributes({
                    "http.status_code": response.status_code,
                    "llm.error": True,
                })
                yield sse_event("error", {"message": f"LLM API error: {response.status_code}"})
                yield sse_event("done", {})
                yield LlmRoundResult(
                    round_content=round_content,
                    tool_calls=tool_calls,
                    should_return=True,
                )
                return

            llm_span.set_attributes({"http.status_code": 200})

            async for content_delta, tc_list, usage in parse_stream_with_tools(response, cancel_signal):
                if cancel_signal.is_set():
                    cancelled = True
                    break

                if content_delta:
                    round_content += content_delta
                    yield sse_event("text_delta", {"delta": content_delta})

                if tc_list is not None:
                    tool_calls = tc_list

                if usage:
                    llm_span.set_attributes({
                        "llm.token_count.prompt": usage.get("prompt_tokens", 0),
                        "llm.token_count.completion": usage.get("completion_tokens", 0),
                        "llm.token_count.total": usage.get("total_tokens", 0),
                    })
    finally:
        llm_span.set_attributes({
            "llm.response.content_length": len(round_content),
            "llm.response.has_tool_calls": bool(tool_calls),
        })
        llm_span.end()

    yield LlmRoundResult(
        round_content=round_content,
        tool_calls=tool_calls,
        cancelled=cancelled,
    )
