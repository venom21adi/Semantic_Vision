"""LiteLLM streaming transport for AI documentation (Milestone 6 /
TASK-08). Kept separate from `ai.context` (context assembly) per the
build plan's cross-cutting requirement.
"""

from __future__ import annotations

import itertools
import os
from collections.abc import Iterator

import litellm

from semantic_vision.ai.context import DocContext

_MODELS = {
    "ollama": os.environ.get("SEMANTIC_VISION_OLLAMA_MODEL", "ollama_chat/llama3"),
    "openai": os.environ.get("SEMANTIC_VISION_OPENAI_MODEL", "gpt-4o-mini"),
    "anthropic": os.environ.get(
        "SEMANTIC_VISION_ANTHROPIC_MODEL", "anthropic/claude-haiku-4-5-20251001"
    ),
}

SYSTEM_PROMPT = """You are documenting a single Python function for a codebase visualizer.
You are given the target function's source, its parent class header (if it's a method), and
the signatures of what it directly calls and what directly calls it.

Write concise Markdown documentation with exactly these level-2 headings, in this order:

## Purpose
## Parameters
## Returns
## Side Effects
## Notes

If a section doesn't apply, write "None." under it rather than omitting the heading. Do not
repeat the function's full source code in your response. Do not wrap the whole response in a
code fence."""


class ProviderError(RuntimeError):
    pass


def stream_documentation(provider: str, context: DocContext) -> Iterator[str]:
    """Eagerly pulls the *first* chunk before returning, so a synchronous
    provider failure (bad model name, connection refused, auth error --
    anything litellm raises immediately) surfaces as `ProviderError` here,
    which the route can still turn into a clean `502` before committing to
    a `StreamingResponse`.

    A failure on a *later* chunk has no equivalent clean path: by then
    `StreamingResponse` has already sent a `200` and started the body, and
    Starlette's own streaming loop has no try/except around iterating the
    body iterator either (only a narrow client-disconnect `OSError` catch
    further out) -- so the exception simply propagates out of this
    iterator uncaught, which ends the HTTP response mid-stream rather than
    producing a clean error the client can distinguish from a normal end
    of stream. Not attempted to be masked here: the exception is left to
    propagate rather than being silently swallowed.
    """
    if provider not in _MODELS:
        raise ProviderError(f"Unknown provider: {provider}")

    try:
        response = litellm.completion(
            model=_MODELS[provider],
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": context.prompt},
            ],
            stream=True,
        )
        first_chunk = next(response, None)
    except ProviderError:
        raise
    except Exception as exc:
        raise ProviderError(f"{provider} documentation generation failed: {exc}") from exc

    def _iter_content() -> Iterator[str]:
        head = [first_chunk] if first_chunk is not None else []
        for chunk in itertools.chain(head, response):
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    return _iter_content()
