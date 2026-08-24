from pathlib import Path

from semantic_vision.dataflow import sqlalchemy_parser, table_usage
from semantic_vision.models import Edge, EdgeKind
from semantic_vision.repo_parser import parse_repository

FIXTURES = Path(__file__).parent / "fixtures"

MODEL_TABLES = {"User": "table::users", "Order": "table::orders"}


def _detect(app_source: str) -> list[Edge]:
    return table_usage.detect({"app.py": app_source}, MODEL_TABLES)


def test_session_query_produces_reads_edge():
    edges = _detect(
        "def get_user(session, user_id):\n"
        "    return session.query(User).filter_by(id=user_id).first()\n"
    )
    assert edges == [Edge(source="app.py::get_user", target="table::users", kind=EdgeKind.READS)]


def test_core_select_call_produces_reads_edge():
    edges = _detect(
        "def get_user(session):\n    return session.execute(select(User)).scalars().all()\n"
    )
    assert edges == [Edge(source="app.py::get_user", target="table::users", kind=EdgeKind.READS)]


def test_direct_model_construction_produces_writes_edge():
    edges = _detect(
        "def create_user(session, name):\n"
        "    user = User(name=name)\n"
        "    session.add(user)\n"
        "    return user\n"
    )
    assert edges == [
        Edge(source="app.py::create_user", target="table::users", kind=EdgeKind.WRITES)
    ]


def test_core_update_and_delete_calls_produce_writes_edges():
    edges = _detect(
        "def deactivate(session, user_id):\n"
        "    session.execute(update(User).where(User.id == user_id).values(active=False))\n\n"
        "def purge(session, user_id):\n"
        "    session.execute(delete(User).where(User.id == user_id))\n"
    )
    assert edges == [
        Edge(source="app.py::deactivate", target="table::users", kind=EdgeKind.WRITES),
        Edge(source="app.py::purge", target="table::users", kind=EdgeKind.WRITES),
    ]


def test_raw_sql_select_produces_reads_edge():
    edges = _detect(
        "def raw_get(cursor, user_id):\n"
        '    cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))\n'
    )
    assert edges == [Edge(source="app.py::raw_get", target="table::users", kind=EdgeKind.READS)]


def test_raw_sql_insert_produces_writes_edge():
    edges = _detect(
        "def raw_insert(cursor, name):\n"
        '    cursor.execute("INSERT INTO users (name) VALUES (%s)", (name,))\n'
    )
    assert edges == [
        Edge(source="app.py::raw_insert", target="table::users", kind=EdgeKind.WRITES)
    ]


def test_raw_sql_table_not_seen_by_orm_still_produces_edge_via_synthesized_id():
    """A raw SQL query can reference a table with no SQLAlchemy model at
    all -- the edge still targets `table::<name>`, matching this
    project's existing convention of edges pointing at ids with no
    backing node (e.g. `external::` call targets)."""
    edges = _detect('def raw(cursor):\n    cursor.execute("SELECT * FROM legacy_orders")\n')
    assert edges == [Edge(source="app.py::raw", target="table::legacy_orders", kind=EdgeKind.READS)]


def test_computed_table_name_in_raw_sql_is_skipped_not_guessed():
    edges = _detect(
        'def raw(cursor, table):\n    cursor.execute(f"SELECT * FROM {table}")\n'
    )
    assert edges == []


def test_sql_string_without_recognized_leading_verb_is_skipped():
    edges = _detect('def call_proc(cursor):\n    cursor.execute("CALL refresh_users()")\n')
    assert edges == []


def test_unrelated_call_named_get_is_not_detected():
    edges = _detect('def lookup(config):\n    return config.get("timeout")\n')
    assert edges == []


def test_generic_get_call_with_a_model_class_argument_is_not_a_false_positive():
    """Regression: a first implementation treated ANY call literally
    named `get` (or `query`/`select`/`insert`/`update`/`delete`) with a
    known model class as its first argument as ORM usage -- `get`/
    `update` are common enough method names on ordinary, unrelated
    objects (a cache, a registry) that this produced real false edges.
    Only `.query(Model)` and `execute(...)`-wrapped calls are recognized
    now; a bare `cache.get(Model, ...)` must not produce an edge."""
    edges = _detect("def lookup(cache):\n    return cache.get(User, None)\n")
    assert edges == []


def test_bare_update_call_with_a_model_class_argument_is_not_a_false_positive():
    """Same regression as above for the write side: a bare `update(...)`
    not wrapped in `execute(...)` -- e.g. a registry/dict-like object's
    own `update` method -- must not produce an edge."""
    edges = _detect("def sync(registry):\n    registry.update(User, object())\n")
    assert edges == []


def test_attribute_qualified_construction_is_not_detected():
    """Only a bare-name `Model(...)` call counts as direct construction
    -- `mod.User(...)` (an attribute-qualified reference) is a weaker,
    more collision-prone signal and is deliberately not matched."""
    edges = _detect("def f(mod):\n    mod.User(id=1)\n")
    assert edges == []


def test_multi_statement_raw_sql_is_classified_per_statement():
    """Regression: a first implementation classified an entire raw SQL
    string by its single leading verb, so a `;`-separated multi-statement
    string had its second statement misclassified by the first
    statement's verb. Each statement must now be judged independently."""
    edges = _detect(
        "def f(cursor):\n"
        '    cursor.execute("SELECT * FROM users; DELETE FROM orders WHERE id=1")\n'
    )
    assert edges == [
        Edge(source="app.py::f", target="table::users", kind=EdgeKind.READS),
        Edge(source="app.py::f", target="table::orders", kind=EdgeKind.WRITES),
    ]


def test_subquery_inside_an_update_statement_does_not_leak_a_spurious_edge():
    """Regression: a first implementation scanned the WHOLE statement for
    every FROM/INTO/UPDATE keyword, so `UPDATE users ... WHERE id IN
    (SELECT id FROM orders)` wrongly counted `orders` as written (it's
    only read, inside a subquery this tokenizer doesn't parse). The
    `UPDATE` target must now come only from the leading `UPDATE <table>`
    keyword itself, not a generic scan -- `orders` should not appear at
    all (skipped, not guessed at, since it's inside an unparsed subquery)."""
    edges = _detect(
        "def f(session):\n"
        '    session.execute("UPDATE users SET x=1 WHERE id IN (SELECT id FROM orders)")\n'
    )
    assert edges == [Edge(source="app.py::f", target="table::users", kind=EdgeKind.WRITES)]


def test_semicolon_inside_a_quoted_string_literal_is_not_a_statement_boundary():
    """Regression: a naive `sql.split(";")` treats a `;` inside a quoted
    string literal's own content (e.g. a free-text notes field) as a
    statement boundary, fabricating a second, spurious statement out of
    the tail of the literal -- here, a fake `DELETE FROM orders`."""
    edges = _detect(
        "def f(cursor):\n"
        "    cursor.execute(\"UPDATE users SET note = 'ok; DELETE FROM orders' WHERE id=1\")\n"
    )
    assert edges == [Edge(source="app.py::f", target="table::users", kind=EdgeKind.WRITES)]


def test_mixed_case_raw_sql_reconciles_to_the_same_table_node_as_the_orm_model():
    edges = _detect('def f(cursor):\n    cursor.execute("select * from Users")\n')
    assert edges == [Edge(source="app.py::f", target="table::users", kind=EdgeKind.READS)]


def test_join_target_is_always_a_reads_edge_even_inside_a_select():
    edges = _detect(
        "def f(cursor):\n"
        '    cursor.execute("SELECT * FROM orders o JOIN users u ON o.user_id = u.id")\n'
    )
    assert edges == [
        Edge(source="app.py::f", target="table::orders", kind=EdgeKind.READS),
        Edge(source="app.py::f", target="table::users", kind=EdgeKind.READS),
    ]


def test_duplicate_touches_in_the_same_function_collapse_to_one_edge():
    edges = _detect(
        "def get_user(session, user_id):\n"
        "    session.query(User).filter_by(id=user_id).first()\n"
        "    return session.query(User).all()\n"
    )
    assert edges == [Edge(source="app.py::get_user", target="table::users", kind=EdgeKind.READS)]


def test_calls_in_a_nested_helper_function_flatten_into_the_enclosing_function():
    edges = _detect(
        "def outer(session):\n"
        "    def helper():\n"
        "        return session.query(User).all()\n"
        "    return helper()\n"
    )
    assert edges == [Edge(source="app.py::outer", target="table::users", kind=EdgeKind.READS)]


def test_dataflow_repo_fixture_produces_expected_reads_edges():
    result = parse_repository(FIXTURES / "dataflow_repo")

    usage_edges = [e for e in result.edges if e.kind in (EdgeKind.READS, EdgeKind.WRITES)]
    assert usage_edges == [
        Edge(source="service.py::get_user", target="table::users", kind=EdgeKind.READS),
        Edge(source="service.py::raw_get_user", target="table::users", kind=EdgeKind.READS),
    ]


def test_extract_and_detect_compose_end_to_end():
    models_source = (
        "from sqlalchemy.orm import declarative_base\n\n"
        "Base = declarative_base()\n\n\n"
        "class User(Base):\n"
        '    __tablename__ = "users"\n'
    )
    app_source = "def get_user(session, user_id):\n    return session.query(User).first()\n"
    sqlalchemy_result = sqlalchemy_parser.extract({"models.py": models_source})

    edges = table_usage.detect({"app.py": app_source}, sqlalchemy_result.model_tables)

    assert edges == [Edge(source="app.py::get_user", target="table::users", kind=EdgeKind.READS)]
