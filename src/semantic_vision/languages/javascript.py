"""The JS/TS `LanguageAdapter` -- glues together `parser/javascript_extractor.py`
and the resolver modules, same "glue, not logic" shape as `languages/python.py`.
One adapter (`language_id="javascript"`) covers the whole JS/TS/JSX/TSX family,
mirroring the extractor's own one-module-for-the-family design.
"""

from __future__ import annotations

import functools

from semantic_vision.languages.base import LanguageAdapter, ParseSyntaxError
from semantic_vision.parser import javascript_extractor
from semantic_vision.parser.extractor import RawModule
from semantic_vision.resolver import js_imports
from semantic_vision.resolver.calls import resolve_calls

FILE_EXTENSIONS = frozenset(javascript_extractor.GRAMMAR_BY_EXTENSION)

# A curated, non-exhaustive list of common JS/Node globals -- good enough
# to keep obvious global calls (console.log, JSON.stringify, setTimeout)
# from being flagged as unresolved-in-repo, not a claim of completeness.
# No DOM types beyond the few Node/browser-interop globals listed, no
# framework globals -- same honesty as the README's JS/TS limitations.
JS_GLOBAL_NAMES = frozenset(
    {
        "console",
        "Object",
        "Array",
        "String",
        "Number",
        "Boolean",
        "Symbol",
        "BigInt",
        "Math",
        "JSON",
        "Date",
        "RegExp",
        "Map",
        "Set",
        "WeakMap",
        "WeakSet",
        "Promise",
        "Proxy",
        "Reflect",
        "Error",
        "TypeError",
        "RangeError",
        "SyntaxError",
        "ReferenceError",
        "EvalError",
        "URIError",
        "Function",
        "undefined",
        "globalThis",
        "parseInt",
        "parseFloat",
        "isNaN",
        "isFinite",
        "encodeURIComponent",
        "decodeURIComponent",
        "encodeURI",
        "decodeURI",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "queueMicrotask",
        "fetch",
        "structuredClone",
        "require",
        "module",
        "exports",
        "__dirname",
        "__filename",
        "process",
        "Buffer",
        "global",
    }
)


def parse_file(source: str, rel_path: str) -> RawModule:
    tree = javascript_extractor.parse_tree(source, rel_path)
    if tree.root_node.has_error:
        raise ParseSyntaxError(
            message=f"Syntax error while parsing {rel_path}",
            line=javascript_extractor.first_error_line(tree),
        )
    return javascript_extractor.extract_module(tree, rel_path)


JAVASCRIPT_ADAPTER = LanguageAdapter(
    language_id="javascript",
    file_extensions=FILE_EXTENSIONS,
    parse_file=parse_file,
    dotted_module_path=js_imports.dotted_module_path,
    resolve_imports=js_imports.resolve_imports,
    resolve_calls=functools.partial(
        resolve_calls,
        self_names=frozenset({"this"}),
        builtin_names=JS_GLOBAL_NAMES,
        builtin_namespace="global",
    ),
)
