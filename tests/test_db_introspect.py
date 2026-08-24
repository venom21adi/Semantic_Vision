from pathlib import Path

import pytest
import sqlalchemy

from semantic_vision.dataflow import db_introspect
from semantic_vision.models import Edge, EdgeKind, NodeKind


def _sqlite_url(db_path: Path) -> str:
    return f"sqlite:///{db_path.as_posix()}"


def _exec(db_path: Path, *statements: str) -> None:
    engine = sqlalchemy.create_engine(_sqlite_url(db_path))
    with engine.begin() as conn:
        for stmt in statements:
            conn.execute(sqlalchemy.text(stmt))
    engine.dispose()


def test_introspects_real_sqlite_tables_and_foreign_key(tmp_path: Path):
    db_path = tmp_path / "app.db"
    _exec(
        db_path,
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, "
        "FOREIGN KEY (user_id) REFERENCES users (id))",
    )

    result = db_introspect.introspect(_sqlite_url(db_path), existing_table_ids=set())

    assert result.tables_ingested == 2
    assert result.tables_created == 2
    assert result.tables_reconciled == 0

    table_ids = {n.id for n in result.nodes}
    assert table_ids == {"table::users", "table::orders"}
    for node in result.nodes:
        assert node.kind == NodeKind.TABLE
        assert node.source == "live_db"

    assert result.edges == [
        Edge(source="table::orders", target="table::users", kind=EdgeKind.FOREIGN_KEY)
    ]


def test_reconciles_onto_an_existing_table_id_without_creating_a_duplicate(tmp_path: Path):
    db_path = tmp_path / "app.db"
    _exec(db_path, "CREATE TABLE users (id INTEGER PRIMARY KEY)")

    result = db_introspect.introspect(
        _sqlite_url(db_path), existing_table_ids={"table::users"}
    )

    assert result.tables_ingested == 1
    assert result.tables_reconciled == 1
    assert result.tables_created == 0
    assert [n for n in result.nodes if n.kind == NodeKind.TABLE] == []


def test_empty_database_produces_no_tables(tmp_path: Path):
    db_path = tmp_path / "empty.db"
    _exec(db_path, "SELECT 1")  # forces file creation, no tables

    result = db_introspect.introspect(_sqlite_url(db_path), existing_table_ids=set())

    assert result.tables_ingested == 0
    assert result.nodes == []
    assert result.edges == []


def test_invalid_connection_string_raises_db_introspect_error():
    with pytest.raises(db_introspect.DbIntrospectError):
        db_introspect.introspect("not-a-valid-url", existing_table_ids=set())


def test_error_message_never_leaks_the_password():
    with pytest.raises(db_introspect.DbIntrospectError) as exc_info:
        db_introspect.introspect(
            "postgresql://user:supersecret@nonexistent-host:5432/db", existing_table_ids=set()
        )
    assert "supersecret" not in str(exc_info.value)


def test_unreachable_sqlite_file_path_raises_db_introspect_error(tmp_path: Path):
    missing = tmp_path / "does_not_exist_dir" / "app.db"
    with pytest.raises(db_introspect.DbIntrospectError):
        db_introspect.introspect(_sqlite_url(missing), existing_table_ids=set())
