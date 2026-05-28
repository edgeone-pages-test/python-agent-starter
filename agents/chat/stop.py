"""
Stop handler -- EdgeOne Pages Functions
========================================

File path agents/chat/stop.py maps to **POST /chat/stop**

Receives conversation_id and aborts the active run via the platform runtime:
  1. Sets the target conversation's cancel signal (asyncio.Event.set())
  2. index.py's streaming loop detects the signal and breaks

IMPORTANT: The stop request must NOT carry the same
`makers-conversation-id` header as the chat request,
otherwise the runtime overwrites the chat's signal.
The target conversation_id is passed only via request body.
"""

from .._logger import create_logger

logger = create_logger("stop")


async def handler(context):
    """Abort the active run for a given conversation."""
    body = context.request.body or {}
    conversation_id = body.get("conversation_id")
    logger.log(f"conversation_id: {conversation_id}")

    if not conversation_id:
        logger.error("conversation_id is required")
        return {
            "status_code": 400,
            "body": {
                "status": "error",
                "message": "conversation_id is required",
            },
        }

    # Call platform runtime's abort mechanism
    utils = getattr(context, "utils", None)
    if utils and hasattr(utils, "abort_active_run"):
        result = utils.abort_active_run(conversation_id)
        logger.log(
            "abort_active_run result:",
            {
                "aborted": result.aborted,
                "conversation_id": result.conversation_id,
                "run_id": result.run_id,
            },
        )
        return {
            "status": "aborting" if result.aborted else "idle",
            "conversationId": result.conversation_id or conversation_id,
            "runId": result.run_id,
            "aborted": result.aborted,
        }

    # Fallback: if no platform utils available
    return {
        "status": "idle",
        "conversationId": conversation_id,
        "aborted": False,
    }
