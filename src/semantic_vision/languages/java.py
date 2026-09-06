"""The Java `LanguageAdapter` -- glues together `parser/java_extractor.py`
and `resolver/java_imports.py`, same "glue, not logic" shape as
`languages/python.py`/`languages/javascript.py`.
"""

from __future__ import annotations

import functools

from semantic_vision.languages.base import LanguageAdapter, ParseSyntaxError
from semantic_vision.parser import java_extractor
from semantic_vision.parser.extractor import RawModule
from semantic_vision.resolver import java_imports
from semantic_vision.resolver.calls import resolve_calls

FILE_EXTENSIONS = java_extractor.FILE_EXTENSIONS

# A curated, non-exhaustive list of `java.lang` members -- `java.lang` is
# implicitly auto-imported into every Java file, so real code routinely
# constructs/references these with no `import` statement at all (unlike
# every other package, which always needs one). `resolve_calls`'s
# `builtin_names` is only ever consulted for a bare, unqualified,
# no-import reference (confirmed against `resolver/calls.py`'s `if not
# rest:` branch) -- a qualified reference like `Math.max(a, b)` never
# reaches it, same pre-existing property JS's own `JS_GLOBAL_NAMES` has
# for `console.log`. So this set's real payoff is specifically bare
# `new Xxx(...)` construction of these types with no import, keeping them
# from showing up as `unresolved::Xxx` instead of `external::java.lang.Xxx`.
JAVA_LANG_NAMES = frozenset(
    {
        "String",
        "Object",
        "StringBuilder",
        "StringBuffer",
        "Math",
        "System",
        "Integer",
        "Long",
        "Double",
        "Float",
        "Boolean",
        "Character",
        "Byte",
        "Short",
        "Number",
        "Thread",
        "Runnable",
        "Comparable",
        "Iterable",
        "CharSequence",
        "Class",
        "Void",
        "Enum",
        "Exception",
        "RuntimeException",
        "Throwable",
        "Error",
        "ClassCastException",
        "NullPointerException",
        "IllegalArgumentException",
        "IllegalStateException",
        "IndexOutOfBoundsException",
        "ArrayIndexOutOfBoundsException",
        "UnsupportedOperationException",
        "NumberFormatException",
        "ArithmeticException",
        "AutoCloseable",
        "Cloneable",
        "SecurityException",
    }
)


def parse_file(source: str, rel_path: str) -> RawModule:
    tree = java_extractor.parse_tree(source, rel_path)
    if tree.root_node.has_error:
        raise ParseSyntaxError(
            message=f"Syntax error while parsing {rel_path}",
            line=java_extractor.first_error_line(tree),
        )
    return java_extractor.extract_module(tree, rel_path)


JAVA_ADAPTER = LanguageAdapter(
    language_id="java",
    file_extensions=FILE_EXTENSIONS,
    parse_file=parse_file,
    dotted_module_path=java_imports.dotted_module_path,
    resolve_imports=java_imports.resolve_imports,
    resolve_calls=functools.partial(
        resolve_calls,
        self_names=frozenset({"this"}),
        builtin_names=JAVA_LANG_NAMES,
        builtin_namespace="java.lang",
    ),
)
