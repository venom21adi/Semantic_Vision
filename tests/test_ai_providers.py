import pytest

from semantic_vision.ai.context import DocContext
from semantic_vision.ai.providers import ProviderError, stream_documentation

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
