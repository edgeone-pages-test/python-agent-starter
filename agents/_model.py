"""
Private module (filename starts with _) -- not mapped as a public route by EdgeOne.
Used to configure the LLM model.

Imported by ./index.py via `from ._model import MODEL_CONFIG, ssl_verify`.

Configure via environment variables: AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL / AI_GATEWAY_MODEL
"""

import os
from dotenv import load_dotenv

load_dotenv()

MODEL_CONFIG = {
    "api_key": os.getenv("AI_GATEWAY_API_KEY", ""),
    "base_url": os.getenv("AI_GATEWAY_BASE_URL", ""),
    "model": os.getenv("AI_GATEWAY_MODEL", "@makers/minimax-m2.7"),
}

# Let httpx/Python use the default certificate verification behavior.
ssl_verify = True
