from pathlib import Path

from semantic_vision.dataflow.sqlalchemy_parser import extract, table_node_id
from semantic_vision.models import Edge, EdgeKind, Node, NodeKind
from semantic_vision.repo_parser import parse_repository

FIXTURES = Path(__file__).parent / "fixtures"


def test_declarative_model_produces_table_node_and_maps_to_edge():
    source = (
        "from sqlalchemy.orm import declarative_base\n"
        "from sqlalchemy import Column, Integer\n\n"
        "Base = declarative_base()\n\n\n"
        "class User(Base):\n"
        '    __tablename__ = "users"\n\n'
        "    id = Column(Integer, primary_key=True)\n"
    )
    result = extract({"models.py": source})

    assert result.nodes == [
        Node(
            id="table::users",
            kind=NodeKind.TABLE,
            label="users",
            file="models.py",
            line_start=7,
            line_end=10,
            source="orm_model",
        )
    ]
    assert result.edges == [
        Edge(source="models.py::User", target="table::users", kind=EdgeKind.MAPS_TO)
    ]


def test_foreign_key_column_produces_foreign_key_edge_between_tables():
    source = (
        "from sqlalchemy.orm import declarative_base\n"
        "from sqlalchemy import Column, ForeignKey, Integer\n\n"
        "Base = declarative_base()\n\n\n"
        "class User(Base):\n"
        '    __tablename__ = "users"\n\n'
        "    id = Column(Integer, primary_key=True)\n\n\n"
        "class Order(Base):\n"
        '    __tablename__ = "orders"\n\n'
        "    id = Column(Integer, primary_key=True)\n"
        '    user_id = Column(Integer, ForeignKey("users.id"))\n'
    )
    result = extract({"models.py": source})

    fk_edges = [e for e in result.edges if e.kind == EdgeKind.FOREIGN_KEY]
    assert fk_edges == [
        Edge(source="table::orders", target="table::users", kind=EdgeKind.FOREIGN_KEY)
    ]


def test_class_without_declarative_base_is_ignored():
    source = 'class User:\n    __tablename__ = "users"\n'
    result = extract({"models.py": source})

    assert result.nodes == []
    assert result.edges == []


def test_class_without_tablename_is_ignored():
    source = (
        "from sqlalchemy.orm import declarative_base\n\n"
        "Base = declarative_base()\n\n\n"
        "class AbstractBase(Base):\n"
        "    __abstract__ = True\n"
    )
    result = extract({"models.py": source})

    assert result.nodes == []
    assert result.edges == []


def test_computed_foreign_key_target_is_skipped_not_guessed():
    source = (
        "from sqlalchemy.orm import declarative_base\n"
        "from sqlalchemy import Column, ForeignKey, Integer\n\n"
        "Base = declarative_base()\n"
        'TARGET = "users.id"\n\n\n'
        "class Order(Base):\n"
        '    __tablename__ = "orders"\n\n'
        "    id = Column(Integer, primary_key=True)\n"
        "    user_id = Column(Integer, ForeignKey(TARGET))\n"
    )
    result = extract({"models.py": source})

    assert [e for e in result.edges if e.kind == EdgeKind.FOREIGN_KEY] == []


def test_schema_qualified_foreign_key_target_resolves_to_table_not_schema():
    source = (
        "from sqlalchemy.orm import declarative_base\n"
        "from sqlalchemy import Column, ForeignKey, Integer\n\n"
        "Base = declarative_base()\n\n\n"
        "class Order(Base):\n"
        '    __tablename__ = "orders"\n\n'
        "    id = Column(Integer, primary_key=True)\n"
        '    user_id = Column(Integer, ForeignKey("myschema.users.id"))\n'
    )
    result = extract({"models.py": source})

    fk_edges = [e for e in result.edges if e.kind == EdgeKind.FOREIGN_KEY]
    assert fk_edges == [
        Edge(source="table::orders", target="table::users", kind=EdgeKind.FOREIGN_KEY)
    ]


def test_malformed_foreign_key_target_with_empty_segment_is_skipped_not_guessed():
    source = (
        "from sqlalchemy.orm import declarative_base\n"
        "from sqlalchemy import Column, ForeignKey, Integer\n\n"
        "Base = declarative_base()\n\n\n"
        "class Order(Base):\n"
        '    __tablename__ = "orders"\n\n'
        "    id = Column(Integer, primary_key=True)\n"
        '    user_id = Column(Integer, ForeignKey("weird..id"))\n'
    )
    result = extract({"models.py": source})

    assert [e for e in result.edges if e.kind == EdgeKind.FOREIGN_KEY] == []


def test_mapped_column_foreign_key_is_detected():
    """SQLAlchemy 2.0 declarative style: `mapped_column(...)` instead of
    `Column(...)`. `__tablename__`/base-class detection is already
    column-syntax-agnostic, so this specifically locks in that FK
    detection covers the same modern idiom, not just the legacy one."""
    source = (
        "from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column\n"
        "from sqlalchemy import ForeignKey\n\n"
        "class Base(DeclarativeBase):\n"
        "    pass\n\n\n"
        "class Order(Base):\n"
        '    __tablename__ = "orders"\n\n'
        "    id: Mapped[int] = mapped_column(primary_key=True)\n"
        '    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))\n'
    )
    result = extract({"models.py": source})

    fk_edges = [e for e in result.edges if e.kind == EdgeKind.FOREIGN_KEY]
    assert fk_edges == [
        Edge(source="table::orders", target="table::users", kind=EdgeKind.FOREIGN_KEY)
    ]


def test_same_table_declared_in_two_files_reconciles_to_one_node():
    sources = {
        "a.py": (
            "from sqlalchemy.orm import declarative_base\n\n"
            "Base = declarative_base()\n\n\n"
            "class UserA(Base):\n"
            '    __tablename__ = "users"\n'
        ),
        "b.py": (
            "from sqlalchemy.orm import declarative_base\n\n"
            "Base = declarative_base()\n\n\n"
            "class UserB(Base):\n"
            '    __tablename__ = "users"\n'
        ),
    }
    result = extract(sources)

    assert len(result.nodes) == 1
    assert result.nodes[0].id == "table::users"
    assert {e.source for e in result.edges if e.kind == EdgeKind.MAPS_TO} == {
        "a.py::UserA",
        "b.py::UserB",
    }


def test_same_foreign_key_declared_in_two_files_produces_one_edge_not_two():
    """The `orders` table's FK to `users` is redeclared identically in
    two files (a realistic near-duplicate-model scenario) -- this must
    reconcile to one `FOREIGN_KEY` edge, not one per file, since the edge
    is table-level, not tied to either file's own column declaration."""
    sources = {
        "a.py": (
            "from sqlalchemy.orm import declarative_base\n"
            "from sqlalchemy import Column, ForeignKey, Integer\n\n"
            "Base = declarative_base()\n\n\n"
            "class OrderA(Base):\n"
            '    __tablename__ = "orders"\n\n'
            "    user_id = Column(Integer, ForeignKey(\"users.id\"))\n"
        ),
        "b.py": (
            "from sqlalchemy.orm import declarative_base\n"
            "from sqlalchemy import Column, ForeignKey, Integer\n\n"
            "Base = declarative_base()\n\n\n"
            "class OrderB(Base):\n"
            '    __tablename__ = "orders"\n\n'
            "    user_id = Column(Integer, ForeignKey(\"users.id\"))\n"
        ),
    }
    result = extract(sources)

    fk_edges = [e for e in result.edges if e.kind == EdgeKind.FOREIGN_KEY]
    assert fk_edges == [
        Edge(source="table::orders", target="table::users", kind=EdgeKind.FOREIGN_KEY)
    ]


def test_dataflow_repo_fixture_produces_expected_table_nodes_and_edges():
    result = parse_repository(FIXTURES / "dataflow_repo")

    table_nodes = [n for n in result.nodes if n.kind == NodeKind.TABLE]
    assert table_nodes == [
        Node(
            id="table::orders",
            kind=NodeKind.TABLE,
            label="orders",
            file="models.py",
            line_start=14,
            line_end=18,
            source="orm_model",
        ),
        Node(
            id="table::users",
            kind=NodeKind.TABLE,
            label="users",
            file="models.py",
            line_start=7,
            line_end=11,
            source="orm_model",
        ),
    ]

    dataflow_edges = [
        e for e in result.edges if e.kind in (EdgeKind.MAPS_TO, EdgeKind.FOREIGN_KEY)
    ]
    assert dataflow_edges == [
        Edge(source="models.py::Order", target="table::orders", kind=EdgeKind.MAPS_TO),
        Edge(source="models.py::User", target="table::users", kind=EdgeKind.MAPS_TO),
        Edge(source="table::orders", target="table::users", kind=EdgeKind.FOREIGN_KEY),
    ]

    # `Class` nodes for the ORM models still come from the normal Python
    # class walk, unmodified by this additive pass.
    assert table_node_id("users") in {e.target for e in dataflow_edges}


def test_javascript_repo_produces_no_dataflow_nodes():
    result = parse_repository(FIXTURES / "js_repo", language="javascript")

    assert [n for n in result.nodes if n.kind == NodeKind.TABLE] == []
