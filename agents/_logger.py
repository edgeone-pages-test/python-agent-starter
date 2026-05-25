"""
Shared logger factory -- private module (starts with _), not mapped as a route.
"""

import sys
from datetime import datetime, timezone


class Logger:
    """Simple tagged logger that writes to stdout/stderr with UTC timestamps."""

    def __init__(self, tag: str) -> None:
        self._tag = tag

    @staticmethod
    def _ts() -> str:
        return datetime.now(timezone.utc).isoformat()

    def log(self, *args: object) -> None:
        print(f"[{self._tag}][{self._ts()}]", *args, flush=True)

    def error(self, *args: object) -> None:
        print(f"[{self._tag}][{self._ts()}]", *args, file=sys.stderr, flush=True)


def create_logger(tag: str) -> Logger:
    """Create a logger with the given tag prefix."""
    return Logger(tag)
