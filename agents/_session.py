"""
Session module -- private module (starts with _), not mapped as a route.

Wraps EdgeOne's context.store (ConversationMemory) to provide a simple
session interface for conversation history persistence.
"""

from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger("session")


class ChatSession:
    """Simple session wrapper over EdgeOne context.store (ConversationMemory)."""

    def __init__(self, store: Any, max_history: int = 50) -> None:
        self._store = store
        self._max_history = max_history

    async def get_history(self, conversation_id: str) -> list[dict[str, str]]:
        """Get conversation history as OpenAI-compatible message dicts."""
        try:
            messages = await self._store.get_messages(
                conversation_id,
                limit=self._max_history,
                order="asc",
            )
            return self._store.to_openai_input(messages)
        except Exception as e:
            _log.error("Failed to get history for %s: %s", conversation_id, e)
            return []

    async def save_user_message(self, conversation_id: str, content: str) -> str:
        return await self._store.append_message(conversation_id, "user", content)

    async def save_assistant_message(self, conversation_id: str, content: str) -> str:
        return await self._store.append_message(conversation_id, "assistant", content)

    async def clear(self, conversation_id: str) -> None:
        try:
            await self._store.clear_messages(conversation_id)
        except Exception as e:
            _log.error("Failed to clear history for %s: %s", conversation_id, e)
