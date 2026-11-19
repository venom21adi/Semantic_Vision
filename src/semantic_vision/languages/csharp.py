"""The C# `LanguageAdapter`.

Unlike the Java/JS adapters, C# resolution needs repository-wide facts (which
types exist in which namespaces, what each type's members and bases are), so
the adapter carries a per-repository `_State`. `bind_root` hands every
`parse_repository` call a fresh one, so nothing leaks between parses; the
`post_parse` hook builds the index once every file has been parsed.
"""

from __future__ import annotations

from semantic_vision.languages.base import LanguageAdapter, ParseSyntaxError
from semantic_vision.models import Edge
from semantic_vision.parser import csharp_extractor
from semantic_vision.parser.extractor import RawModule
from semantic_vision.resolver import csharp_resolver
from semantic_vision.resolver.csharp_projects import ProjectMap
from semantic_vision.resolver.imports import ImportBinding, ImportResolution
from semantic_vision.resolver.symbol_table import ModuleIndex

FILE_EXTENSIONS = csharp_extractor.FILE_EXTENSIONS


class _State:
    def __init__(self, projects: ProjectMap | None = None) -> None:
        self.modules: dict[str, RawModule] = {}
        self.index: csharp_resolver.CsIndex | None = None
        self.projects = projects

    def ensure_index(self, modules: dict[str, RawModule] | None = None) -> csharp_resolver.CsIndex:
        if self.index is None:
            self.index = csharp_resolver.CsIndex(
                modules if modules is not None else self.modules, self.projects
            )
            csharp_resolver.mark_dispatch_targets(self.index)
        return self.index


def dotted_module_path(rel_path: str) -> str:
    """C# has no file-to-namespace correspondence to resolve through (a
    namespace spans files and directories), so this is only a unique key:
    `src/Foo/Bar.cs` -> `src.Foo.Bar`."""
    return rel_path.removesuffix(".cs").replace("/", ".")


def _make_adapter(state: _State) -> LanguageAdapter:
    def parse_file(source: str, rel_path: str) -> RawModule:
        tree = csharp_extractor.parse_tree(source)
        module = csharp_extractor.extract_module(tree, rel_path)
        data = module.lang_data
        if (
            tree.root_node.has_error
            and not module.classes
            and not module.imports
            and (data is None or data.top_level is None)
        ):
            # Nothing at all could be recovered. A file with *some* errors (typically
            # `#if/#else` blocks the grammar cannot follow) is kept: dropping it would
            # silently remove its types from the graph.
            raise ParseSyntaxError(
                message=f"Syntax error while parsing {rel_path}",
                line=csharp_extractor.first_error_line(tree),
            )
        state.modules[rel_path] = module
        return module

    def post_parse(modules: dict[str, RawModule]) -> None:
        state.ensure_index(modules)

    def resolve_imports(
        rel_path: str,
        raw: RawModule,
        module_by_dotted: dict[str, str],
        modules: dict[str, ModuleIndex],
    ) -> ImportResolution:
        return csharp_resolver.resolve_imports(state.ensure_index(), rel_path, raw, modules)

    def resolve_calls(
        rel_path: str,
        raw: RawModule,
        module_index: ModuleIndex,
        bindings: dict[str, ImportBinding],
        modules: dict[str, ModuleIndex],
        module_by_dotted: dict[str, str],
    ) -> list[Edge]:
        return csharp_resolver.resolve_module_calls(state.ensure_index(), rel_path, raw)

    return LanguageAdapter(
        language_id="csharp",
        file_extensions=FILE_EXTENSIONS,
        parse_file=parse_file,
        dotted_module_path=dotted_module_path,
        resolve_imports=resolve_imports,
        resolve_calls=resolve_calls,
        excluded_dirs=csharp_extractor.EXCLUDED_DIRS,
        # Per repository: a fresh state, with the `.csproj` layout so a type name resolves
        # among the projects a file can actually see.
        bind_root=lambda root: _make_adapter(_State(ProjectMap.scan(root))),
        post_parse=post_parse,
    )


CSHARP_ADAPTER = _make_adapter(_State())
