import json
from pathlib import Path

import pytest

from semantic_vision.dataflow import dbt_ingest
from semantic_vision.models import EdgeKind, NodeKind

FIXTURES = Path(__file__).parent / "fixtures"


def _write_manifest(tmp_path: Path, nodes: dict) -> str:
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps({"nodes": nodes}), encoding="utf-8")
    return str(manifest_path)


def test_fixture_manifest_reconciles_existing_table_and_creates_a_new_one():
    """`stg_users` (aliased to `users`) reconciles onto an already-known
    `table::users`; `fct_orders` (no matching existing table) gets a
    freshly created `Table` node. A `test.*` node depending on
    `fct_orders` is present in the fixture and must be entirely ignored
    (not a model)."""
    result = dbt_ingest.ingest(
        str(FIXTURES / "dbt_manifest.json"), existing_table_ids={"table::users", "table::orders"}
    )

    assert result.models_ingested == 2
    assert result.tables_reconciled == 1
    assert result.tables_created == 1

    dbt_model_nodes = [n for n in result.nodes if n.kind == NodeKind.DBT_MODEL]
    assert {n.id for n in dbt_model_nodes} == {
        "dbt::model.my_project.stg_users",
        "dbt::model.my_project.fct_orders",
    }

    table_nodes = [n for n in result.nodes if n.kind == NodeKind.TABLE]
    assert len(table_nodes) == 1
    assert table_nodes[0].id == "table::fct_orders"
    assert table_nodes[0].source == "dbt"

    materializes = {(e.source, e.target) for e in result.edges if e.kind == EdgeKind.MATERIALIZES}
    assert materializes == {
        ("dbt::model.my_project.stg_users", "table::users"),
        ("dbt::model.my_project.fct_orders", "table::fct_orders"),
    }


def test_references_edge_points_from_dependent_model_to_its_dependency():
    result = dbt_ingest.ingest(str(FIXTURES / "dbt_manifest.json"), existing_table_ids=set())

    references = [e for e in result.edges if e.kind == EdgeKind.REFERENCES]
    assert len(references) == 1
    assert references[0].source == "dbt::model.my_project.fct_orders"
    assert references[0].target == "dbt::model.my_project.stg_users"


def test_source_dependency_does_not_produce_a_references_edge():
    """`stg_users`'s own `depends_on` is a `source.*` node, not another
    model -- `REFERENCES` is documented as dbt-model-to-dbt-model only,
    so `stg_users` must not be the *source* of any `REFERENCES` edge
    (it legitimately IS the *target* of one, from `fct_orders`, which
    does depend on a real model)."""
    result = dbt_ingest.ingest(str(FIXTURES / "dbt_manifest.json"), existing_table_ids=set())

    stg_users_id = "dbt::model.my_project.stg_users"
    assert not any(
        e.kind == EdgeKind.REFERENCES and e.source == stg_users_id for e in result.edges
    )


def test_ephemeral_model_gets_no_materializes_edge(tmp_path: Path):
    """An ephemeral model is inlined into whatever references it at
    compile time -- it never materializes its own table or view, so no
    `MATERIALIZES` edge (or fresh `Table` node) should be fabricated."""
    manifest_path = _write_manifest(
        tmp_path,
        {
            "model.p.stg_thing": {
                "resource_type": "model",
                "name": "stg_thing",
                "unique_id": "model.p.stg_thing",
                "config": {"materialized": "ephemeral"},
            }
        },
    )
    result = dbt_ingest.ingest(manifest_path, existing_table_ids=set())

    assert result.models_ingested == 1
    assert result.tables_created == 0
    assert result.tables_reconciled == 0
    assert [e for e in result.edges if e.kind == EdgeKind.MATERIALIZES] == []
    assert [n for n in result.nodes if n.kind == NodeKind.TABLE] == []


def test_two_models_reconciling_to_the_same_new_table_only_create_it_once(tmp_path: Path):
    manifest_path = _write_manifest(
        tmp_path,
        {
            "model.p.a": {
                "resource_type": "model",
                "name": "a",
                "unique_id": "model.p.a",
                "alias": "shared",
            },
            "model.p.b": {
                "resource_type": "model",
                "name": "b",
                "unique_id": "model.p.b",
                "alias": "shared",
            },
        },
    )
    result = dbt_ingest.ingest(manifest_path, existing_table_ids=set())

    assert result.tables_created == 1
    assert result.tables_reconciled == 1
    assert len([n for n in result.nodes if n.kind == NodeKind.TABLE]) == 1


def test_duplicate_depends_on_entries_produce_one_references_edge_not_two(tmp_path: Path):
    manifest_path = _write_manifest(
        tmp_path,
        {
            "model.p.a": {
                "resource_type": "model",
                "name": "a",
                "unique_id": "model.p.a",
            },
            "model.p.b": {
                "resource_type": "model",
                "name": "b",
                "unique_id": "model.p.b",
                "depends_on": {"nodes": ["model.p.a", "model.p.a"]},
            },
        },
    )
    result = dbt_ingest.ingest(manifest_path, existing_table_ids=set())

    references = [e for e in result.edges if e.kind == EdgeKind.REFERENCES]
    assert len(references) == 1


def test_model_with_no_alias_and_no_name_falls_back_to_unique_id_rather_than_dropping_the_edge(
    tmp_path: Path,
):
    """A non-ephemeral model missing both `alias` and `name` is a
    malformed manifest, not a real dbt shape, but must not silently
    lose its `MATERIALIZES` edge -- it falls back to `unique_id`."""
    manifest_path = _write_manifest(
        tmp_path,
        {
            "model.p.mystery": {
                "resource_type": "model",
                "unique_id": "model.p.mystery",
            }
        },
    )
    result = dbt_ingest.ingest(manifest_path, existing_table_ids=set())

    materializes = [e for e in result.edges if e.kind == EdgeKind.MATERIALIZES]
    assert len(materializes) == 1
    assert materializes[0].target == dbt_ingest.table_node_id("model.p.mystery")


def test_missing_manifest_file_raises_dbt_manifest_error(tmp_path: Path):
    with pytest.raises(dbt_ingest.DbtManifestError):
        dbt_ingest.ingest(str(tmp_path / "does_not_exist.json"), existing_table_ids=set())


def test_invalid_json_raises_dbt_manifest_error(tmp_path: Path):
    bad = tmp_path / "manifest.json"
    bad.write_text("not json", encoding="utf-8")
    with pytest.raises(dbt_ingest.DbtManifestError):
        dbt_ingest.ingest(str(bad), existing_table_ids=set())


def test_json_without_nodes_key_raises_dbt_manifest_error(tmp_path: Path):
    bad = tmp_path / "manifest.json"
    bad.write_text(json.dumps({"metadata": {}}), encoding="utf-8")
    with pytest.raises(dbt_ingest.DbtManifestError):
        dbt_ingest.ingest(str(bad), existing_table_ids=set())
