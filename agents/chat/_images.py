"""
Image extraction & redaction for tool results.

Why this exists
---------------
EdgeOne sandbox tools (notably `browser_screenshot` and `code_interpreter`
with image output) return raw values whose payloads can include base64-
encoded images. If we let those flow through ``json.dumps`` straight into
``messages.append({"role": "tool", "content": ...})``, the next chat-
completions round re-feeds the entire image as text into the model —
burning tokens, breaking the context window, and pushing huge strings
through the AI gateway.

This module gives the chat handler a single hook::

    extraction = extract_images_from_tool_result(raw)
    # extraction.images, extraction.redacted_result, extraction.truncated

Images are pulled out, replaced with a short ``[image:<id>]`` placeholder
(so the model still knows *something* visual happened), and the rest of
the structure is returned untouched for normal stringification.

Detection rules
---------------
- Only specific dict KEYS are inspected (``base64Image`` / ``imageBase64``
  / ``screenshot``). A free-form string that happens to be base64 is the
  caller's business — we don't misclassify text dumps as images.
- String candidates must clear ``MIN_BASE64_LEN``, to avoid treating tiny
  inline data (8x8 placeholder gifs, ``<img>`` srcset b64 icons) as tool
  screenshots that deserve a separate UI row.
- ``MAX_IMAGES`` per tool call is enforced — beyond that, additional
  images are still REDACTED (to a ``[image:truncated]`` placeholder) so
  the base64 still doesn't escape into the next request, but their bytes
  are dropped on the floor.

Notes for Python
----------------
We deliberately recurse only into ``dict`` and ``list`` — Pydantic models,
dataclasses, and SDK-internal types are passed through untouched. EdgeOne
tool handlers in this template return plain dicts/lists/strings; if a
specific tool returns a wrapper class, surface a passthrough adapter at
the handler boundary rather than teaching this walker about it.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, NamedTuple


class ExtractedImage(NamedTuple):
    image_id: str
    base64: str        # Raw base64 payload, no `data:` prefix.
    mime_type: str
    size: int          # Approximate decoded byte size (base64.length * 3 / 4).


class ImageExtraction(NamedTuple):
    images: list[ExtractedImage]
    # Original value with image fields replaced by `[image:<imageId>]`
    # placeholders. Same shape as the input — caller can json.dumps it as-is
    # and feed it back to the model.
    redacted_result: Any
    truncated: bool    # True when MAX_IMAGES was hit and additional images were dropped.


# Field names we treat as candidate base64 images on dict values.
# Conservative: do NOT include the bare `image` / `data` keys here — too
# many tools use them for non-image payloads.
IMAGE_FIELDS: frozenset[str] = frozenset({
    "base64Image",
    "imageBase64",
    "screenshot",
})

# Field names whose values are arrays of images (each item a string OR an
# object with `base64`/`base64Image`/`data` field).
IMAGE_ARRAY_FIELDS: frozenset[str] = frozenset({"images", "screenshots"})

MIN_BASE64_LEN = 1024
MAX_IMAGES = 8

# Tight base64 charset, including base64url's `-_` variants. Anchored.
# Whitespace tolerated for tools that line-wrap their output.
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=_\-\s]+$")
# `data:<mime>;base64,<payload>` — common from code_interpreter and any tool
# that hands the model an inline image URL. We strip the prefix and treat
# the payload like a normal base64 string.
_DATA_URL_RE = re.compile(
    r"^data:(image/[a-zA-Z0-9.+\-]+);base64,([A-Za-z0-9+/=_\-\s]+)$"
)
# Cheap pre-flight test for the string-input fast path. If a serialized
# payload doesn't contain ANY of these markers, we can skip the JSON.parse
# + walk + JSON.stringify round-trip entirely. Most tool results
# (commands stdout, plain text, web_search hits) miss every marker.
#
# Adding a new image-bearing field name? Add it here too, otherwise the
# fast path will silently swallow images.
_HAS_IMAGE_MARKER_RE = re.compile(
    r'(?:base64Image|imageBase64|"screenshot"|"images"|"screenshots"|data:image/)'
)

_TRUNCATED_PLACEHOLDER = "[image:truncated]"


def _placeholder_for(image_id: str) -> str:
    return f"[image:{image_id}]"


def _normalize_base64(value: Any, fallback_mime: str) -> tuple[str, str] | None:
    """Return ``(base64, mime_type)`` if value looks like a base64 image, else None.

    Handles plain base64, base64url (``-_``), and ``data:image/...;base64,...``
    data URLs. Length floor and charset both enforced.
    """
    if not isinstance(value, str):
        return None
    m = _DATA_URL_RE.match(value)
    if m:
        mime, payload = m.group(1), m.group(2)
        if len(payload) < MIN_BASE64_LEN:
            return None
        return payload, mime
    if len(value) < MIN_BASE64_LEN:
        return None
    if not _BASE64_RE.match(value):
        return None
    return value, fallback_mime


def _approx_size(b64: str) -> int:
    """Rough byte-size estimate for UI display only."""
    cleaned = re.sub(r"[^A-Za-z0-9+/_\-]", "", b64)
    return (len(cleaned) * 3) // 4


def _Ctx() -> dict[str, Any]:  # noqa: N802 — short alias for a tiny mutable carrier
    return {"out": [], "truncated": False}


def _extract_from_string(value: str, mime_type: str, ctx: dict[str, Any]) -> str:
    """If `value` looks like a base64 image, push to ctx['out'] and return a placeholder.

    CRITICAL: when MAX_IMAGES is hit we still replace the value with
    `_TRUNCATED_PLACEHOLDER` rather than leaving the raw base64 in place —
    otherwise a runaway tool's screenshot 9..N would still flow back to
    the model on the next round, defeating the whole point of redaction.
    """
    normalized = _normalize_base64(value, mime_type)
    if normalized is None:
        return value
    if len(ctx["out"]) >= MAX_IMAGES:
        ctx["truncated"] = True
        return _TRUNCATED_PLACEHOLDER
    payload, mime = normalized
    image_id = str(uuid.uuid4())
    ctx["out"].append(
        ExtractedImage(
            image_id=image_id,
            base64=payload,
            mime_type=mime,
            size=_approx_size(payload),
        )
    )
    return _placeholder_for(image_id)


def _walk(node: Any, ctx: dict[str, Any]) -> Any:
    """Recursively walk the tool result, redacting image fields in place.

    Returns a value structurally identical to the input but with image
    fields replaced. Recurses ONLY into dict and list — every other type
    (Pydantic model, dataclass, SDK class, primitive, ...) is returned
    unchanged. This keeps the walker oblivious to tool-handler internals.
    """
    if isinstance(node, list):
        return [_walk(item, ctx) for item in node]
    if isinstance(node, dict):
        # Sibling-level mime hint for any base64 fields at this level.
        mime_type = node.get("mimeType") or node.get("mime_type") or "image/png"
        if not isinstance(mime_type, str):
            mime_type = "image/png"

        out: dict[str, Any] = {}
        for key, val in node.items():
            if key in IMAGE_FIELDS and isinstance(val, str):
                out[key] = _extract_from_string(val, mime_type, ctx)
                continue
            if key in IMAGE_ARRAY_FIELDS and isinstance(val, list):
                out[key] = [_walk_image_array_item(item, mime_type, ctx) for item in val]
                continue
            out[key] = _walk(val, ctx)
        return out
    return node


def _walk_image_array_item(item: Any, mime_type: str, ctx: dict[str, Any]) -> Any:
    """Handle one element of a known image-array field (`images` / `screenshots`)."""
    if isinstance(item, str):
        return _extract_from_string(item, mime_type, ctx)
    if isinstance(item, dict):
        item_mime = item.get("mimeType") or item.get("mime_type") or mime_type
        if not isinstance(item_mime, str):
            item_mime = mime_type
        candidate = item.get("base64")
        if candidate is None:
            candidate = item.get("base64Image")
        if candidate is None:
            candidate = item.get("data")
        normalized = _normalize_base64(candidate, item_mime)
        if normalized is not None:
            if len(ctx["out"]) >= MAX_IMAGES:
                ctx["truncated"] = True
                # Same redaction rule — don't leave raw base64 in the dict.
                return {**item, "base64": _TRUNCATED_PLACEHOLDER}
            payload, mime = normalized
            image_id = str(uuid.uuid4())
            ctx["out"].append(
                ExtractedImage(
                    image_id=image_id,
                    base64=payload,
                    mime_type=mime,
                    size=_approx_size(payload),
                )
            )
            return {**item, "base64": _placeholder_for(image_id)}
        return _walk(item, ctx)
    return item


def extract_images_from_tool_result(result: Any) -> ImageExtraction:
    """Extract base64 images from any tool handler return value.

    The input can be string, dict, list, or anything else. We mutate only
    where we find a recognized image field. Strings that look like
    JSON-serialized objects are parsed-walked-restringified so embedded
    image fields are still found.
    """
    ctx = _Ctx()

    if isinstance(result, str):
        # Fast path: if the serialized payload doesn't contain a marker
        # that could be an image field, skip the parse+walk dance. This
        # is the common case — commands stdout / plain text / web_search /
        # any tool that doesn't deal with images at all.
        if not _HAS_IMAGE_MARKER_RE.search(result):
            return ImageExtraction(images=[], redacted_result=result, truncated=False)
        stripped = result.lstrip()
        if stripped[:1] in ("{", "["):
            try:
                parsed = json.loads(stripped)
                walked = _walk(parsed, ctx)
                # Re-serialize so the caller can drop it straight back into
                # a `tool` message content slot. If no images extracted,
                # keep the original string (avoid pointless reformatting).
                redacted = (
                    json.dumps(walked, ensure_ascii=False) if ctx["out"] else result
                )
                return ImageExtraction(
                    images=ctx["out"],
                    redacted_result=redacted,
                    truncated=ctx["truncated"],
                )
            except (json.JSONDecodeError, ValueError, TypeError):
                # Not actually JSON despite the leading `{`/`[` — pass through.
                pass
        return ImageExtraction(images=[], redacted_result=result, truncated=False)

    walked = _walk(result, ctx)
    # Symmetric to the string branch: if no images were extracted, the
    # deep clone produced by _walk is structurally identical to `result`
    # — return the original so the caller's downstream serialization
    # works on the same reference, no clone allocated for nothing.
    return ImageExtraction(
        images=ctx["out"],
        redacted_result=walked if ctx["out"] else result,
        truncated=ctx["truncated"],
    )
