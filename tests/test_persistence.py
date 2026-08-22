from pathlib import Path

from acv_ad.persistence import store
from acv_ad.persistence.models import NodePosition


def test_graph_state_round_trips(tmp_path: Path):
    positions = {
        "app.py::Greeter.greet": NodePosition(x=10.5, y=-3.0),
        "app.py::Greeter": NodePosition(x=0, y=0),
    }

    store.write_graph_state(tmp_path, positions)
    state = store.read_graph_state(tmp_path)

    assert state.positions == positions
    assert state.updated_at is not None


def test_graph_state_save_merges_with_previously_saved_positions(tmp_path: Path):
    """A save only ever carries positions for whatever nodes a client
    currently has rendered -- e.g. the frontend's File view shows a
    scoped subset of the graph -- so saving that subset must not discard
    every other node's previously saved position."""
    store.write_graph_state(
        tmp_path,
        {
            "app.py::Greeter.greet": NodePosition(x=10, y=20),
            "helpers.py::format_name": NodePosition(x=30, y=40),
        },
    )

    store.write_graph_state(tmp_path, {"app.py::Greeter.greet": NodePosition(x=99, y=99)})
    state = store.read_graph_state(tmp_path)

    assert state.positions == {
        "app.py::Greeter.greet": NodePosition(x=99, y=99),  # updated
        "helpers.py::format_name": NodePosition(x=30, y=40),  # preserved
    }


def test_graph_state_defaults_to_empty_when_unsaved(tmp_path: Path):
    state = store.read_graph_state(tmp_path)

    assert state.positions == {}
    assert state.updated_at is None


def test_graph_state_survives_corrupted_file(tmp_path: Path):
    visualiser = tmp_path / ".visualiser"
    visualiser.mkdir()
    (visualiser / "graph_state.json").write_text("{not valid json", encoding="utf-8")

    state = store.read_graph_state(tmp_path)

    assert state.positions == {}


def test_metadata_round_trips(tmp_path: Path):
    store.write_metadata(tmp_path, node_count=5, edge_count=7, parse_error_count=0)

    metadata = store.read_metadata(tmp_path)

    assert metadata is not None
    assert metadata.node_count == 5
    assert metadata.edge_count == 7
    assert metadata.parse_error_count == 0
    assert metadata.parsed_at


def test_metadata_defaults_to_none_when_unsaved(tmp_path: Path):
    assert store.read_metadata(tmp_path) is None


def test_doc_round_trips(tmp_path: Path):
    entry = store.write_doc(tmp_path, "app.py::Greeter.greet", "# greet\n\nPurpose: greets.")

    markdown = store.read_doc(tmp_path, "app.py::Greeter.greet")
    index = store.read_docs_index(tmp_path)

    assert markdown == "# greet\n\nPurpose: greets."
    assert [e.node_id for e in index.entries] == ["app.py::Greeter.greet"]
    assert index.entries[0].hash == entry.hash


def test_doc_missing_for_unknown_node_returns_none(tmp_path: Path):
    assert store.read_doc(tmp_path, "app.py::unknown") is None


def test_doc_hash_is_deterministic_and_distinct():
    assert store.doc_hash("app.py::a") == store.doc_hash("app.py::a")
    assert store.doc_hash("app.py::a") != store.doc_hash("app.py::b")


def test_write_doc_replaces_previous_entry_for_same_node(tmp_path: Path):
    store.write_doc(tmp_path, "app.py::greet", "first version")
    store.write_doc(tmp_path, "app.py::greet", "second version")

    index = store.read_docs_index(tmp_path)

    assert len(index.entries) == 1
    assert store.read_doc(tmp_path, "app.py::greet") == "second version"
