"""Integration-level coverage for `resolver/symbol_table.py`'s node-id
construction, run through the real pipeline (`parse_repository`) rather
than hand-built `Raw*` objects -- exercises the actual extractor ->
resolver ->symbol-table path a real getter/setter pair goes through.
"""

from pathlib import Path

from semantic_vision.models import EdgeKind, NodeKind
from semantic_vision.repo_parser import parse_repository
from semantic_vision.ts_locate import locate

FIXTURES = Path(__file__).parent / "fixtures"
GETTER_SETTER_REPO = FIXTURES / "getter_setter_repo"


def test_getter_and_setter_get_distinct_node_ids():
    result = parse_repository(str(GETTER_SETTER_REPO), language="javascript")
    function_ids = {n.id for n in result.nodes if n.kind == NodeKind.FUNCTION}

    assert "app.ts::Box.value#get" in function_ids
    assert "app.ts::Box.value#set" in function_ids
    # Two distinct nodes, not one silently overwriting the other.
    assert len({n.id for n in result.nodes if n.kind == NodeKind.FUNCTION}) == len(
        [n for n in result.nodes if n.kind == NodeKind.FUNCTION]
    )


def test_getter_and_setter_labels_stay_the_bare_method_name():
    # `label` deliberately does NOT get a "get "/"set " prefix -- ts_locate
    # matches by (line, label) against the extractor's plain-name output,
    # so changing label here would break locate() for exactly these nodes.
    result = parse_repository(str(GETTER_SETTER_REPO), language="javascript")
    by_id = {n.id: n for n in result.nodes}

    assert by_id["app.ts::Box.value#get"].label == "value"
    assert by_id["app.ts::Box.value#set"].label == "value"


def test_getter_and_setter_nodes_carry_their_accessor_kind():
    # Presentational-only field for the frontend to show "get foo"/"set foo"
    # instead of two identically-labeled boxes -- `label` itself stays bare
    # (see the label test above), this is additive, not a replacement.
    result = parse_repository(str(GETTER_SETTER_REPO), language="javascript")
    by_id = {n.id: n for n in result.nodes}

    assert by_id["app.ts::Box.value#get"].accessor_kind == "get"
    assert by_id["app.ts::Box.value#set"].accessor_kind == "set"
    assert by_id["app.ts::Box.plain"].accessor_kind is None


def test_a_plain_method_id_has_no_accessor_suffix():
    # The non-colliding regression case: every id format outside the
    # getter/setter case is completely unchanged.
    result = parse_repository(str(GETTER_SETTER_REPO), language="javascript")
    function_ids = {n.id for n in result.nodes if n.kind == NodeKind.FUNCTION}

    assert "app.ts::Box.plain" in function_ids
    assert not any(fid.startswith("app.ts::Box.plain#") for fid in function_ids)


def test_a_call_to_a_getter_setter_name_is_ambiguous_not_silently_wrong():
    """`this.value()` in `useIt()` could mean the getter or the setter --
    before the id-disambiguation fix, both shared one id, so any
    resolution was trivially "correct" by construction. After the fix,
    they're genuinely distinct nodes, so resolving to a *specific* one
    here would be a silent guess -- worse than the old behavior, not
    better. `resolver/symbol_table.py`'s `ModuleIndex.methods` must not
    let the getter/setter registration collision resolve to whichever one
    happened to be registered last; `resolver/calls.py`'s shorthand
    lookup should instead fall through to its existing unresolved/
    ambiguous-edge path."""
    result = parse_repository(str(GETTER_SETTER_REPO), language="javascript")
    call_edges = [
        e
        for e in result.edges
        if e.kind == EdgeKind.CALLS and e.source == "app.ts::Box.useIt"
    ]

    assert len(call_edges) == 1
    edge = call_edges[0]
    assert edge.target not in ("app.ts::Box.value#get", "app.ts::Box.value#set")
    assert edge.ambiguous is True


def test_ts_locate_resolves_the_getter_and_setter_to_distinct_lines():
    result = parse_repository(str(GETTER_SETTER_REPO), language="javascript")
    by_id = {n.id: n for n in result.nodes}
    getter_node = by_id["app.ts::Box.value#get"]
    setter_node = by_id["app.ts::Box.value#set"]
    root = Path(result.root)

    getter_def = locate(root, getter_node, {}, {})
    setter_def = locate(root, setter_node, {}, {})

    assert getter_def is not None
    assert setter_def is not None
    assert getter_def.type == "method_definition"
    assert setter_def.type == "method_definition"
    assert getter_def.start_point != setter_def.start_point
