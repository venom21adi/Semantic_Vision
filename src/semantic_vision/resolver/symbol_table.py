"""Builds canonical graph nodes/`defines` edges and a lookup index used by
import and call resolution.

Canonical ids follow the convention from the build plan:
`relative/path/file.py::ClassName.method_name`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from semantic_vision.models import Edge, EdgeKind, Node, NodeKind, Variable
from semantic_vision.parser.extractor import RawClass, RawModule


@dataclass
class ModuleIndex:
    rel_path: str
    file_id: str
    dotted: str
    functions: dict[str, str] = field(default_factory=dict)
    """Top-level function name -> node id."""
    classes: dict[str, str] = field(default_factory=dict)
    """Class name -> node id."""
    methods: dict[tuple[str, str], str] = field(default_factory=dict)
    """(class name, method name) -> node id."""


@dataclass
class SymbolTable:
    nodes: list[Node]
    defines_edges: list[Edge]
    variables: list[Variable]
    modules: dict[str, ModuleIndex]
    """rel_path -> ModuleIndex, for every discovered file (even ones that
    failed to parse -- those get an entry with empty function/class maps
    so import resolution can still point at their file node)."""
    module_by_dotted: dict[str, str]
    """dotted module path (e.g. "pkg.sub.mod") -> rel_path."""


def _register_class(
    cls: RawClass,
    class_id: str,
    rel_path: str,
    defining_source_id: str,
    top_level: bool,
    nodes: list[Node],
    defines_edges: list[Edge],
    variables: list[Variable],
    index: ModuleIndex,
) -> None:
    """Registers a class (and, recursively, everything nested inside it --
    methods, attributes, and further nested classes) as graph nodes.

    Only a *top-level* class's own name/methods are registered in the
    module's flat lookup index, since that index backs simple-name call
    resolution (`ClassName()`, `self.method()`) which doesn't reach
    through nested scopes. Nested classes still get full nodes/edges --
    they are never silently dropped -- just not indexed for that
    shorthand resolution.
    """
    nodes.append(
        Node(
            id=class_id,
            kind=NodeKind.CLASS,
            label=cls.name,
            file=rel_path,
            line_start=cls.lineno,
            line_end=cls.end_lineno,
        )
    )
    defines_edges.append(Edge(source=defining_source_id, target=class_id, kind=EdgeKind.DEFINES))
    if top_level:
        index.classes[cls.name] = class_id

    for var in cls.attributes:
        variables.append(
            Variable(
                id=f"{class_id}.{var.name}",
                name=var.name,
                file=rel_path,
                line=var.lineno,
                annotation=var.annotation,
                scope=class_id,
            )
        )

    for method in cls.methods:
        method_id = f"{class_id}.{method.name}"
        nodes.append(
            Node(
                id=method_id,
                kind=NodeKind.FUNCTION,
                label=method.name,
                file=rel_path,
                line_start=method.lineno,
                line_end=method.end_lineno,
            )
        )
        defines_edges.append(Edge(source=class_id, target=method_id, kind=EdgeKind.DEFINES))
        if top_level:
            index.methods[(cls.name, method.name)] = method_id
        for nested in method.nested_classes:
            _register_class(
                nested,
                f"{method_id}.{nested.name}",
                rel_path,
                method_id,
                False,
                nodes,
                defines_edges,
                variables,
                index,
            )

    for nested in cls.nested_classes:
        _register_class(
            nested,
            f"{class_id}.{nested.name}",
            rel_path,
            class_id,
            False,
            nodes,
            defines_edges,
            variables,
            index,
        )


def build_symbol_table(
    all_rel_paths: list[str],
    raw_modules: dict[str, RawModule],
    line_counts: dict[str, int],
    *,
    dotted_module_path: Callable[[str], str],
) -> SymbolTable:
    nodes: list[Node] = []
    defines_edges: list[Edge] = []
    variables: list[Variable] = []
    modules: dict[str, ModuleIndex] = {}
    module_by_dotted: dict[str, str] = {}

    directories: dict[str, str | None] = {}  # dir id -> parent dir id (or None)
    for rel_path in all_rel_paths:
        parts = rel_path.split("/")
        for depth in range(1, len(parts)):
            dir_id = "/".join(parts[:depth])
            parent_id = "/".join(parts[: depth - 1]) if depth > 1 else None
            directories[dir_id] = parent_id

    for dir_id, parent_id in sorted(directories.items()):
        nodes.append(
            Node(
                id=dir_id,
                kind=NodeKind.DIRECTORY,
                label=dir_id.rsplit("/", 1)[-1],
                file=dir_id,
                line_start=0,
                line_end=0,
            )
        )
        if parent_id is not None:
            defines_edges.append(Edge(source=parent_id, target=dir_id, kind=EdgeKind.DEFINES))

    for rel_path in all_rel_paths:
        parts = rel_path.split("/")
        parent_dir = "/".join(parts[:-1]) if len(parts) > 1 else None
        line_end = line_counts.get(rel_path, 1)
        nodes.append(
            Node(
                id=rel_path,
                kind=NodeKind.FILE,
                label=parts[-1],
                file=rel_path,
                line_start=1,
                line_end=line_end,
            )
        )
        if parent_dir is not None:
            defines_edges.append(Edge(source=parent_dir, target=rel_path, kind=EdgeKind.DEFINES))

        dotted = dotted_module_path(rel_path)
        if dotted:
            module_by_dotted[dotted] = rel_path

        index = ModuleIndex(rel_path=rel_path, file_id=rel_path, dotted=dotted)
        modules[rel_path] = index

        raw = raw_modules.get(rel_path)
        if raw is None:
            continue

        for var in raw.variables:
            variables.append(
                Variable(
                    id=f"{rel_path}::{var.name}",
                    name=var.name,
                    file=rel_path,
                    line=var.lineno,
                    annotation=var.annotation,
                    scope=rel_path,
                )
            )

        for func in raw.functions:
            func_id = f"{rel_path}::{func.name}"
            nodes.append(
                Node(
                    id=func_id,
                    kind=NodeKind.FUNCTION,
                    label=func.name,
                    file=rel_path,
                    line_start=func.lineno,
                    line_end=func.end_lineno,
                )
            )
            defines_edges.append(Edge(source=rel_path, target=func_id, kind=EdgeKind.DEFINES))
            index.functions[func.name] = func_id
            for nested in func.nested_classes:
                _register_class(
                    nested,
                    f"{func_id}.{nested.name}",
                    rel_path,
                    func_id,
                    False,
                    nodes,
                    defines_edges,
                    variables,
                    index,
                )

        for cls in raw.classes:
            _register_class(
                cls,
                f"{rel_path}::{cls.name}",
                rel_path,
                rel_path,
                True,
                nodes,
                defines_edges,
                variables,
                index,
            )

    return SymbolTable(
        nodes=nodes,
        defines_edges=defines_edges,
        variables=variables,
        modules=modules,
        module_by_dotted=module_by_dotted,
    )
