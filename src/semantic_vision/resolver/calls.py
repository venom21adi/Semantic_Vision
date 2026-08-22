"""Resolves call sites within a module's functions/methods into `calls`
graph edges, using the module's own symbol index plus its import bindings.
"""

from __future__ import annotations

import builtins

from semantic_vision.models import Edge, EdgeKind
from semantic_vision.parser.extractor import RawCall, RawClass, RawModule
from semantic_vision.resolver.imports import ImportBinding
from semantic_vision.resolver.symbol_table import ModuleIndex

BUILTIN_NAMES = frozenset(vars(builtins))


def resolve_calls(
    rel_path: str,
    raw: RawModule,
    module_index: ModuleIndex,
    bindings: dict[str, ImportBinding],
    modules: dict[str, ModuleIndex],
    module_by_dotted: dict[str, str],
) -> list[Edge]:
    edges: list[Edge] = []

    def resolve(function_id: str, call: RawCall, class_name: str | None) -> Edge:
        return _resolve_call(
            rel_path,
            function_id,
            call,
            module_index,
            bindings,
            modules,
            module_by_dotted,
            class_name,
        )

    def resolve_class(cls: RawClass, class_id: str, defining_source_id: str) -> None:
        # A class decorator (e.g. `@register("thing")`) runs in whatever
        # scope the `class` statement itself lives in, at definition
        # time -- not "inside" the class.
        for call in cls.decorator_calls:
            edges.append(resolve(defining_source_id, call, None))

        for method in cls.methods:
            function_id = f"{class_id}.{method.name}"
            for call in method.calls:
                edges.append(resolve(function_id, call, cls.name))
            # Method decorators evaluate during class-body execution, in
            # the enclosing class's scope, not the method's own scope.
            for call in method.decorator_calls:
                edges.append(resolve(class_id, call, None))
            for nested in method.nested_classes:
                resolve_class(nested, f"{function_id}.{nested.name}", function_id)

        for nested in cls.nested_classes:
            resolve_class(nested, f"{class_id}.{nested.name}", class_id)

    for func in raw.functions:
        function_id = f"{rel_path}::{func.name}"
        for call in func.calls:
            edges.append(resolve(function_id, call, None))
        # Decorators on a top-level function evaluate in module scope,
        # not inside the function body -- attribute them to the file.
        for call in func.decorator_calls:
            edges.append(resolve(rel_path, call, None))
        for nested in func.nested_classes:
            resolve_class(nested, f"{function_id}.{nested.name}", function_id)

    for cls in raw.classes:
        resolve_class(cls, f"{rel_path}::{cls.name}", rel_path)

    return edges


def _unresolved(function_id: str, label: str) -> Edge:
    return Edge(
        source=function_id, target=f"unresolved::{label}", kind=EdgeKind.CALLS, ambiguous=True
    )


def _external(function_id: str, qualname: str) -> Edge:
    return Edge(
        source=function_id, target=f"external::{qualname}", kind=EdgeKind.CALLS, external=True
    )


def _resolve_call(
    rel_path: str,
    function_id: str,
    call: RawCall,
    module_index: ModuleIndex,
    bindings: dict[str, ImportBinding],
    modules: dict[str, ModuleIndex],
    module_by_dotted: dict[str, str],
    class_name: str | None,
) -> Edge:
    if call.dotted is None:
        return _unresolved(function_id, f"dynamic@{rel_path}:{call.lineno}")

    dotted = call.dotted
    root, _, rest = dotted.partition(".")

    if root in ("self", "cls") and class_name is not None and rest and "." not in rest:
        method_id = module_index.methods.get((class_name, rest))
        if method_id:
            return Edge(source=function_id, target=method_id, kind=EdgeKind.CALLS)
        return _unresolved(function_id, f"{class_name}.{rest}")

    if root in bindings:
        return _resolve_via_binding(
            function_id, dotted, rest, bindings[root], modules, module_by_dotted
        )

    if not rest:
        if root in module_index.functions:
            return Edge(
                source=function_id, target=module_index.functions[root], kind=EdgeKind.CALLS
            )
        if root in module_index.classes:
            return Edge(
                source=function_id, target=module_index.classes[root], kind=EdgeKind.CALLS
            )
        if root in BUILTIN_NAMES:
            return _external(function_id, f"builtins.{root}")
    elif "." not in rest and root in module_index.classes:
        method_id = module_index.methods.get((root, rest))
        if method_id:
            return Edge(source=function_id, target=method_id, kind=EdgeKind.CALLS)

    return _unresolved(function_id, dotted)


def _resolve_via_binding(
    function_id: str,
    dotted: str,
    rest: str,
    binding: ImportBinding,
    modules: dict[str, ModuleIndex],
    module_by_dotted: dict[str, str],
) -> Edge:
    if not rest:
        if binding.symbol_id:
            return Edge(source=function_id, target=binding.symbol_id, kind=EdgeKind.CALLS)
        if binding.external:
            return _external(function_id, binding.dotted_prefix or dotted)
        return _unresolved(function_id, dotted)

    if binding.external:
        qualname = f"{binding.dotted_prefix}.{rest}" if binding.dotted_prefix else dotted
        return _external(function_id, qualname)

    if binding.dotted_prefix is None:
        # A resolved symbol (function/class) or an unresolved local name
        # with no module namespace to keep walking through further
        # attribute access on it is dynamic/unknown.
        return _unresolved(function_id, dotted)

    # Walk the reconstructed dotted path (e.g. "pkg" + ".sub.mod.deep")
    # to find the longest prefix that is a known local module, treating
    # whatever remains as the symbol name inside it. This is what makes
    # multi-hop chains like `pkg.sub.mod.deep()` (from `import pkg.sub.mod`)
    # resolve, not just a single attribute hop.
    full_dotted = f"{binding.dotted_prefix}.{rest}"
    candidate_module, _, candidate_symbol = full_dotted.rpartition(".")
    if candidate_module in module_by_dotted:
        target_rel = module_by_dotted[candidate_module]
        target_index = modules.get(target_rel)
        symbol_id = None
        if target_index is not None:
            symbol_id = target_index.functions.get(candidate_symbol) or target_index.classes.get(
                candidate_symbol
            )
        if symbol_id:
            return Edge(source=function_id, target=symbol_id, kind=EdgeKind.CALLS)
        return _unresolved(function_id, f"{target_rel}::{candidate_symbol}")

    return _unresolved(function_id, full_dotted)
