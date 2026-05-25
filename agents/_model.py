"""
Private module (filename starts with _) -- not mapped as a public route by EdgeOne.
Used to configure the LLM model.

Imported by ./index.py via `from ._model import MODEL_CONFIG, ssl_verify`.

Configure via environment variables: AI_GATEWAY_API_KEY / AI_GATEWAY_BASE_URL / AI_GATEWAY_MODEL

IMPORTANT: This module also fixes SSL globally for the entire Python process,
including EdgeOne platform toolkit calls (context.tools / sandbox).
"""

import os
import ssl
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


# ========== Fix SSL for the entire process ==========
# The EdgeOne platform toolkit (pages_agent_toolkit) uses httpx internally.
# On macOS local dev, Python often can't find the CA bundle, causing
# CERTIFICATE_VERIFY_FAILED for all HTTPS calls (including sandbox tools).
# We fix this globally by pointing SSL_CERT_FILE to a valid CA bundle.

def _fix_ssl_globally() -> None:
    """Ensure SSL_CERT_FILE points to a valid CA bundle for the whole process."""
    existing = os.environ.get("SSL_CERT_FILE", "")

    # If it's already a valid file, nothing to do
    if existing and os.path.isfile(existing):
        return

    # Remove invalid/stale entry
    os.environ.pop("SSL_CERT_FILE", None)

    # Search for a valid CA bundle
    candidates = []

    # 1. Try certifi (pip-installed)
    try:
        import certifi
        candidates.append(certifi.where())
    except ImportError:
        pass

    # 2. Bundled certifi in EdgeOne runtime (relative to this file)
    #    _model.py is at agents/chat/_model.py -> parents[2] = project root
    bundled = Path(__file__).resolve().parents[2] / ".edgeone" / "agent-python" / "lib" / "certifi" / "cacert.pem"
    candidates.append(str(bundled))

    # 3. Common macOS/Linux system paths
    candidates.extend([
        "/usr/local/etc/openssl@3/cert.pem",
        "/usr/local/etc/openssl/cert.pem",
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
    ])

    for path in candidates:
        if os.path.isfile(path):
            os.environ["SSL_CERT_FILE"] = path
            os.environ["REQUESTS_CA_BUNDLE"] = path  # Also for requests library
            return


_fix_ssl_globally()


MODEL_CONFIG = {
    "api_key": os.getenv("AI_GATEWAY_API_KEY", ""),
    "base_url": os.getenv("AI_GATEWAY_BASE_URL", ""),
    "model": os.getenv("AI_GATEWAY_MODEL", "@Pages/minimax-m2.7"),
}

# SSL verification for our own httpx calls.
# Build an explicit SSLContext from the CA bundle we found, so we don't
# rely on Python's ssl module auto-discovering the cert file.
_cert_file = os.environ.get("SSL_CERT_FILE", "")
if _cert_file and os.path.isfile(_cert_file):
    _ssl_ctx = ssl.create_default_context(cafile=_cert_file)
    ssl_verify: ssl.SSLContext | bool = _ssl_ctx
else:
    import warnings
    warnings.warn(
        "No valid CA bundle found. SSL verification will use Python/httpx system defaults. "
        "If you see certificate errors, install certifi or set SSL_CERT_FILE.",
        stacklevel=2,
    )
    ssl_verify: ssl.SSLContext | bool = True  # let httpx use system defaults; never disable
