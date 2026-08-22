import json
import urllib.error

import pytest

from semantic_vision.ai.context import DocContext
from semantic_vision.ai.providers import ProviderError, list_ollama_models, stream_documentation

CONTEXT = DocContext(
    node_id="app.py::greet", prompt="## Target function\n\ndef greet(): ...", omitted=[]
)


class _FakeDelta:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.delta = _FakeDelta(content)


class _FakeChunk:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


def test_stream_documentation_yields_chunk_content(monkeypatch):
    def fake_completion(**kwargs):
        assert kwargs["stream"] is True
        return iter([_FakeChunk("Hello"), _FakeChunk(None), _FakeChunk(" world")])

    monkeypatch.setattr("semantic_vision.ai.providers.litellm.completion", fake_completion)

    chunks = list(stream_documentation("ollama", CONTEXT))

    assert chunks == ["Hello", " world"]


def test_stream_documentation_surfaces_provider_failure_before_yielding(monkeypatch):
    def failing_completion(**kwargs):
        raise ConnectionError("connection refused")

    monkeypatch.setattr("semantic_vision.ai.providers.litellm.completion", failing_completion)

    with pytest.raises(ProviderError):
        stream_documentation("ollama", CONTEXT)


def test_stream_documentation_rejects_unknown_provider():
    with pytest.raises(ProviderError):
        stream_documentation("not-a-real-provider", CONTEXT)


def test_stream_documentation_propagates_a_mid_stream_failure(monkeypatch):
    """A failure on the *second* chunk (after the eager first-chunk pull
    already succeeded) has no clean HTTP-error path -- see the docstring
    on `stream_documentation` -- but it must not be silently swallowed
    either. It should propagate to whoever is iterating the returned
    generator, same as any other exception raised mid-iteration.
    """

    def flaky_stream():
        yield _FakeChunk("Hello")
        raise ConnectionError("dropped mid-stream")

    def fake_completion(**kwargs):
        return flaky_stream()

    monkeypatch.setattr("semantic_vision.ai.providers.litellm.completion", fake_completion)

    stream = stream_documentation("ollama", CONTEXT)
    assert next(stream) == "Hello"
    with pytest.raises(ConnectionError):
        next(stream)


def test_stream_documentation_uses_the_requested_ollama_model(monkeypatch):
    captured = {}

    def fake_completion(**kwargs):
        captured.update(kwargs)
        return iter([_FakeChunk("ok")])

    monkeypatch.setattr("semantic_vision.ai.providers.litellm.completion", fake_completion)

    list(stream_documentation("ollama", CONTEXT, model="qwen2.5-coder:3b"))

    assert captured["model"] == "ollama_chat/qwen2.5-coder:3b"


def test_stream_documentation_falls_back_to_default_ollama_model_when_none_requested(
    monkeypatch,
):
    captured = {}

    def fake_completion(**kwargs):
        captured.update(kwargs)
        return iter([_FakeChunk("ok")])

    monkeypatch.setattr("semantic_vision.ai.providers.litellm.completion", fake_completion)

    list(stream_documentation("ollama", CONTEXT))

    assert captured["model"] == "ollama_chat/llama3"


def test_stream_documentation_ignores_model_override_for_non_ollama_providers(monkeypatch):
    captured = {}

    def fake_completion(**kwargs):
        captured.update(kwargs)
        return iter([_FakeChunk("ok")])

    monkeypatch.setattr("semantic_vision.ai.providers.litellm.completion", fake_completion)

    list(stream_documentation("openai", CONTEXT, model="some-ollama-only-tag"))

    assert captured["model"] == "gpt-4o-mini"


class _FakeUrlResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._payload


def test_list_ollama_models_returns_sorted_names(monkeypatch):
    payload = json.dumps({"models": [{"name": "llama3.2:3b"}, {"name": "gemma4:e4b"}]}).encode()

    def fake_urlopen(url, timeout=None):
        return _FakeUrlResponse(payload)

    monkeypatch.setattr("semantic_vision.ai.providers.urllib.request.urlopen", fake_urlopen)

    assert list_ollama_models() == ["gemma4:e4b", "llama3.2:3b"]


def test_list_ollama_models_returns_empty_list_when_unreachable(monkeypatch):
    def failing_urlopen(url, timeout=None):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr("semantic_vision.ai.providers.urllib.request.urlopen", failing_urlopen)

    assert list_ollama_models() == []
