"""
History handler -- EdgeOne Makers
==========================================

File path agents/history/index.py maps to **POST /history**

Reads conversation history from ctx.store for the given conversation_id
(passed via `makers-conversation-id` header by the frontend).
Used to restore the chat window after page refresh.
"""

from typing import Any

from .._logger import create_logger

logger = create_logger("history")

_CONTENT_KEYS = ("content", "output", "text")


def _content_to_text(content: Any) -> str:
    """Convert memory content to a displayable string for the frontend."""
    if isinstance(content, str):
        return content

    if isinstance(content, dict):
        for key in _CONTENT_KEYS:
            if key in content:
                return _content_to_text(content[key]) if key != "text" else str(content[key] or "")
        return ""

    if isinstance(content, list):
        parts = [
            str(item.get("text") or item.get("output_text") or "")
            for item in content
            if isinstance(item, dict)
        ]
        return "\n".join(p for p in parts if p)

    return str(content)


async def handler(context: Any):
    """Return conversation history as a list of messages."""
    cid = context.conversation_id

    store = getattr(context, "store", None)
    if store is None:
        return {"messages": []}

    try:
        history = await store.get_messages(cid, limit=100, order="asc")
    except Exception as e:
        logger.error(f"[history] failed to get messages: {e}")
        return {"messages": []}

    messages: list[dict] = []
    for item in history:
        role = getattr(item, "role", None)
        if role not in ("user", "assistant"):
            continue

        content = _content_to_text(getattr(item, "content", ""))
        if not content:
            continue

        messages.append({
            "id": getattr(item, "message_id", None) or f"{role}-{getattr(item, 'created_at', 0)}",
            "role": role,
            "content": content,
            "timestamp": getattr(item, "created_at", None) or 0,
        })

    return {"conversation_id": cid, "messages": messages}
