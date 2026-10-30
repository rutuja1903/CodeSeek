"""
analysis.py -- Static Code Intelligence

Find References, Call Hierarchy, Change Impact and Potentially Unused symbols,
computed from the existing index (files, symbols, imports, calls) using the same
name-resolution rules as the call and dependency graphs in graphs.py.

Everything here is static analysis of indexed data: project code is never
imported or executed. Python name resolution without runtime type information
is approximate, so every relationship carries a confidence label:

  resolved    -- the name matches exactly one definition in the project
  ambiguous   -- several project definitions share the name; this may be one of them
  name_match  -- the imported name matches, but the module could not be resolved
  unresolved  -- (outgoing calls only) no project definition; builtin, external or dynamic

Symbols are identified by their deterministic_id ("path.py::Class.method") and
files by project-relative path, both of which survive re-indexing. File ids are
returned only for navigation and are always read fresh from the current index.
"""

import os
import re
import json
from collections import Counter, defaultdict

from app.database.core import get_connection
from app.services.graphs import FUNCTION_TYPES, path_to_module, resolve_import_target, callee_short_name

STATIC_NOTICE = (
    "Static-analysis findings based on names in the indexed source. They show likely "
    "relationships, not guaranteed runtime behaviour: dynamic dispatch, reflection, "
    "decorators and code outside this project are not visible."
)

UNUSED_CAVEAT = (
    "Potentially unused means no call, import, subclass or other mention of the name was "
    "found outside its own definition. This can be a false positive for code used through "
    "dynamic imports, getattr/reflection, decorators or registries, plugin and framework "
    "hooks, or external entry points (scripts, CLI tools, tests, other packages)."
)

_IDENTIFIER_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")

# Files whose symbols are typically invoked by tooling rather than by project code
_ENTRY_POINT_FILES = {"__main__.py", "conftest.py", "setup.py", "manage.py", "wsgi.py", "asgi.py"}
_ENTRY_POINT_NAMES = {"main"}
_TEST_HOOK_NAMES = {"setUp", "tearDown", "setUpClass", "tearDownClass", "setUpModule", "tearDownModule", "asyncSetUp", "asyncTearDown"}

# Top-level analysis caps keep responses bounded on very large projects
MAX_AMBIGUOUS_TARGETS = 10


class SymbolNotFound(LookupError):
    pass


class FileNotIndexed(LookupError):
    pass


class NotAFunction(ValueError):
    pass


class ProjectIndex:
    """
    In-memory view of one project's index, loaded with a fixed number of queries
    (no per-symbol or per-file lookups). Rows pointing at files that no longer
    exist in the index are dropped instead of failing.
    """

    def __init__(self, project_id: int, db_path: str = "codeseek.db"):
        self.project_id = project_id
        self.db_path = db_path

        conn = get_connection(db_path)
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT id, relative_path FROM files WHERE project_id = ?", (project_id,))
            self.file_paths = {row["id"]: row["relative_path"] for row in cursor.fetchall()}

            cursor.execute(
                "SELECT deterministic_id, file_id, name, symbol_type, start_line, end_line, parent_id, bases "
                "FROM symbols WHERE project_id = ?",
                (project_id,),
            )
            symbol_rows = cursor.fetchall()

            cursor.execute(
                "SELECT file_id, caller_symbol_id, raw_callee_name, line_number FROM calls WHERE project_id = ?",
                (project_id,),
            )
            call_rows = cursor.fetchall()

            cursor.execute(
                "SELECT file_id, module, imported_name, alias, line_number FROM imports WHERE project_id = ?",
                (project_id,),
            )
            import_rows = cursor.fetchall()
        finally:
            conn.close()

        self.file_ids = {path: file_id for file_id, path in self.file_paths.items()}
        self.module_to_file = {path_to_module(path): path for path in self.file_paths.values()}

        self.symbols = {}
        self.functions_by_name = defaultdict(list)
        self.classes_by_name = defaultdict(list)
        for row in symbol_rows:
            path = self.file_paths.get(row["file_id"])
            if path is None:
                continue
            try:
                bases = json.loads(row["bases"]) if row["bases"] else []
            except ValueError:
                bases = []
            sym = {
                "symbol_id": row["deterministic_id"],
                "name": row["name"],
                "symbol_type": row["symbol_type"],
                "file_id": row["file_id"],
                "relative_path": path,
                "start_line": row["start_line"],
                "end_line": row["end_line"],
                "parent_id": row["parent_id"],
                "bases": bases,
            }
            self.symbols[sym["symbol_id"]] = sym
            if sym["symbol_type"] in FUNCTION_TYPES:
                self.functions_by_name[sym["name"]].append(sym["symbol_id"])
            elif sym["symbol_type"] == "class":
                self.classes_by_name[sym["name"]].append(sym["symbol_id"])

        # class symbol_id -> names of methods defined directly in it
        self.method_names_by_class = defaultdict(set)
        for sym in self.symbols.values():
            if sym["parent_id"] and sym["symbol_type"] in FUNCTION_TYPES:
                self.method_names_by_class[sym["parent_id"]].add(sym["name"])

        self.calls = []
        for row in call_rows:
            path = self.file_paths.get(row["file_id"])
            callee = row["raw_callee_name"]
            if path is None or not callee:
                continue
            self.calls.append({
                "file_id": row["file_id"],
                "relative_path": path,
                "caller_id": row["caller_symbol_id"],
                "callee": callee,
                "short": callee_short_name(callee),
                "line": row["line_number"],
            })

        self.imports = []
        for row in import_rows:
            path = self.file_paths.get(row["file_id"])
            if path is None or not row["imported_name"]:
                continue
            self.imports.append({
                "file_id": row["file_id"],
                "relative_path": path,
                "module": row["module"],
                "name": row["imported_name"],
                "alias": row["alias"],
                "line": row["line_number"],
            })

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def get_symbol(self, symbol_id: str) -> dict:
        sym = self.symbols.get(symbol_id)
        if sym is None:
            raise SymbolNotFound(symbol_id)
        return sym

    def call_candidates(self, short_name: str) -> list:
        """
        Project definitions a call short name may refer to. Functions/methods first
        (same rule as the call graph); class names when no function matches
        (class instantiation).
        """
        functions = self.functions_by_name.get(short_name)
        if functions:
            return functions
        return self.classes_by_name.get(short_name, [])

    def import_target(self, imp: dict):
        """Resolve an import row to a project file path (same rule as the dependency graph)."""
        return resolve_import_target(imp["module"], imp["name"], self.module_to_file)

    def load_sources(self, file_ids=None) -> dict:
        """Return {file_id: source} for the given files (all files when None), in one query."""
        conn = get_connection(self.db_path)
        try:
            cursor = conn.cursor()
            if file_ids is None:
                cursor.execute("SELECT id, source FROM files WHERE project_id = ?", (self.project_id,))
            else:
                ids = sorted(set(file_ids))
                if not ids:
                    return {}
                cursor.execute(
                    "SELECT id, source FROM files WHERE project_id = ? AND id IN ({})".format(", ".join("?" * len(ids))),
                    (self.project_id, *ids),
                )
            return {row["id"]: row["source"] or "" for row in cursor.fetchall()}
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _summary(sym: dict) -> dict:
    """Public shape of a symbol in analysis results."""
    return {
        "symbol_id": sym["symbol_id"],
        "name": sym["name"],
        "symbol_type": sym["symbol_type"],
        "relative_path": sym["relative_path"],
        "file_id": sym["file_id"],
        "start_line": sym["start_line"],
        "end_line": sym["end_line"],
    }


def _caller_context(index: ProjectIndex, caller_id):
    """Summary of the function containing a call; None for module-level code."""
    if not caller_id:
        return None
    sym = index.symbols.get(caller_id)
    if sym is None:
        # Caller row without a matching symbol (stale index): keep the id, flag it
        return {"symbol_id": caller_id, "name": caller_id.split("::")[-1].split(".")[-1], "stale": True}
    return _summary(sym)


def _confidence(candidates: list) -> str:
    return "resolved" if len(candidates) == 1 else "ambiguous"


def _attach_snippets(index: ProjectIndex, items: list) -> list:
    """Add the source line text to each item with file_id/line, loading each file once."""
    sources = index.load_sources(item["file_id"] for item in items if item.get("file_id"))
    lines_cache = {}
    for item in items:
        file_id = item.get("file_id")
        line = item.get("line")
        if file_id not in sources or not line:
            continue
        if file_id not in lines_cache:
            lines_cache[file_id] = sources[file_id].split("\n")
        lines = lines_cache[file_id]
        if 1 <= line <= len(lines):
            item["snippet"] = lines[line - 1].strip()[:240]
    return items


def _sort_locations(items: list) -> list:
    return sorted(items, key=lambda r: (r.get("relative_path") or "", r.get("line") or 0))


def _import_references(index: ProjectIndex, sym: dict) -> list:
    """
    Imports of a top-level function or class from other files. Resolves
    "from module import name" exactly like the dependency graph, plus two common
    patterns the graph leaves unresolved: one-level re-exports through a package
    __init__.py, and sibling-relative imports (the parser does not keep the
    relative-import level).
    """
    if sym["parent_id"] is not None:
        return []

    def resolves_to_symbol(imp):
        target = index.import_target(imp)
        if target == sym["relative_path"]:
            return "resolved"
        if target and target.endswith("__init__.py"):
            # Re-export: the package __init__ itself imports the name from the symbol's file
            for inner in index.imports:
                if inner["relative_path"] == target and inner["name"] == sym["name"] and index.import_target(inner) == sym["relative_path"]:
                    return "resolved"
            return None
        if target is None:
            directory = os.path.dirname(imp["relative_path"]).replace("/", ".")
            sibling = f"{directory}.{imp['module']}" if directory else imp["module"]
            if index.module_to_file.get(sibling) == sym["relative_path"]:
                return "resolved"
            return "name_match"
        return None

    refs = []
    for imp in index.imports:
        if imp["module"] is None or imp["name"] != sym["name"] or imp["relative_path"] == sym["relative_path"]:
            continue
        confidence = resolves_to_symbol(imp)
        if confidence is None:
            continue
        statement = f"from {imp['module']} import {imp['name']}" + (f" as {imp['alias']}" if imp["alias"] else "")
        refs.append({
            "kind": "import",
            "relative_path": imp["relative_path"],
            "file_id": imp["file_id"],
            "line": imp["line"],
            "text": statement,
            "alias": imp["alias"],
            "confidence": confidence,
            "context": None,
        })
    return refs


def _incoming_calls(index: ProjectIndex, sym: dict, import_refs: list) -> list:
    """Call sites that may target sym, including calls through an import alias."""
    aliases = defaultdict(dict)  # relative_path -> {alias: confidence}
    for ref in import_refs:
        if ref["alias"]:
            aliases[ref["relative_path"]][ref["alias"]] = ref["confidence"]

    kind = "instantiation" if sym["symbol_type"] == "class" else "call"
    calls = []
    for call in index.calls:
        candidates = index.call_candidates(call["short"])
        if sym["symbol_id"] in candidates:
            confidence = _confidence(candidates)
        elif call["callee"] in aliases.get(call["relative_path"], {}):
            confidence = aliases[call["relative_path"]][call["callee"]]
        else:
            continue
        calls.append({
            "kind": kind,
            "relative_path": call["relative_path"],
            "file_id": call["file_id"],
            "line": call["line"],
            "text": f"{call['callee']}()",
            "confidence": confidence,
            "context": _caller_context(index, call["caller_id"]),
        })
    return calls


def _subclass_references(index: ProjectIndex, sym: dict) -> list:
    if sym["symbol_type"] != "class":
        return []
    confidence = _confidence(index.classes_by_name.get(sym["name"], []))
    refs = []
    for other in index.symbols.values():
        if other["symbol_type"] != "class" or other["symbol_id"] == sym["symbol_id"]:
            continue
        if any(callee_short_name(base) == sym["name"] for base in other["bases"]):
            refs.append({
                "kind": "subclass",
                "relative_path": other["relative_path"],
                "file_id": other["file_id"],
                "line": other["start_line"],
                "text": f"class {other['name']}({', '.join(other['bases'])})",
                "confidence": confidence,
                "context": _summary(other),
            })
    return refs


def _collect_references(index: ProjectIndex, sym: dict) -> list:
    import_refs = _import_references(index, sym)
    refs = _incoming_calls(index, sym, import_refs) + import_refs + _subclass_references(index, sym)
    for ref in refs:
        ref.pop("alias", None)
    return _sort_locations(refs)


def _group_by_file(refs: list) -> list:
    files = {}
    for ref in refs:
        entry = files.setdefault(ref["relative_path"], {
            "relative_path": ref["relative_path"],
            "file_id": ref["file_id"],
            "reference_count": 0,
            "kinds": Counter(),
        })
        entry["reference_count"] += 1
        entry["kinds"][ref["kind"]] += 1
    return [{**f, "kinds": dict(f["kinds"])} for f in sorted(files.values(), key=lambda f: f["relative_path"])]


# ---------------------------------------------------------------------------
# 1. Find References
# ---------------------------------------------------------------------------

def find_references(index: ProjectIndex, symbol_id: str) -> dict:
    sym = index.get_symbol(symbol_id)
    refs = _attach_snippets(index, _collect_references(index, sym))
    return {
        "symbol": _summary(sym),
        "references": refs,
        "files": _group_by_file(refs),
        "counts": dict(Counter(r["kind"] for r in refs)),
        "notice": STATIC_NOTICE,
    }


# ---------------------------------------------------------------------------
# 2. Call Hierarchy
# ---------------------------------------------------------------------------

def _alias_targets(index: ProjectIndex, relative_path: str) -> dict:
    """{alias: symbol_id} for "from m import name as alias" imports in a file that resolve to a project symbol."""
    targets = {}
    for imp in index.imports:
        if imp["relative_path"] != relative_path or not imp["alias"] or imp["module"] is None:
            continue
        for candidate_id in index.functions_by_name.get(imp["name"], []) + index.classes_by_name.get(imp["name"], []):
            candidate = index.symbols[candidate_id]
            if candidate["parent_id"] is None and any(r["line"] == imp["line"] for r in _import_references(index, candidate) if r["relative_path"] == relative_path):
                targets[imp["alias"]] = candidate_id
    return targets


def _outgoing_calls(index: ProjectIndex, sym: dict) -> list:
    outgoing = []
    aliases = _alias_targets(index, sym["relative_path"])
    for call in index.calls:
        if call["caller_id"] != sym["symbol_id"]:
            continue
        candidates = index.call_candidates(call["short"])
        if not candidates and call["callee"] in aliases:
            candidates = [aliases[call["callee"]]]
        item = {
            "relative_path": call["relative_path"],
            "file_id": call["file_id"],
            "line": call["line"],
            "text": f"{call['callee']}()",
            "callee": call["callee"],
        }
        if not candidates:
            item.update(confidence="unresolved", target=None, candidates=[])
        elif len(candidates) == 1:
            item.update(confidence="resolved", target=_summary(index.symbols[candidates[0]]), candidates=[])
        else:
            item.update(
                confidence="ambiguous",
                target=None,
                candidates=[_summary(index.symbols[c]) for c in candidates[:MAX_AMBIGUOUS_TARGETS]],
                candidate_count=len(candidates),
            )
        outgoing.append(item)
    return sorted(outgoing, key=lambda c: c["line"] or 0)


def call_hierarchy(index: ProjectIndex, symbol_id: str) -> dict:
    sym = index.get_symbol(symbol_id)
    if sym["symbol_type"] not in FUNCTION_TYPES:
        raise NotAFunction(symbol_id)

    incoming = _sort_locations(_incoming_calls(index, sym, _import_references(index, sym)))
    outgoing = _outgoing_calls(index, sym)
    _attach_snippets(index, incoming + outgoing)
    return {
        "symbol": _summary(sym),
        "incoming": incoming,
        "outgoing": outgoing,
        "notice": STATIC_NOTICE,
    }


# ---------------------------------------------------------------------------
# 3. Change Impact
# ---------------------------------------------------------------------------

def _unique_symbols(symbols: list) -> list:
    seen = {}
    for s in symbols:
        seen.setdefault(s["symbol_id"], s)
    return sorted(seen.values(), key=lambda s: (s["relative_path"], s["start_line"] or 0))


def symbol_impact(index: ProjectIndex, symbol_id: str) -> dict:
    sym = index.get_symbol(symbol_id)
    refs = _collect_references(index, sym)

    callers = _unique_symbols([
        r["context"] for r in refs
        if r["kind"] in ("call", "instantiation") and r["context"] and not r["context"].get("stale")
    ])
    module_level_uses = sum(1 for r in refs if r["kind"] in ("call", "instantiation") and r["context"] is None)

    related = []

    def add_related(relation, related_sym):
        related.append({"relation": relation, "symbol": _summary(related_sym)})

    if sym["symbol_type"] == "class":
        methods = [s for s in index.symbols.values() if s["parent_id"] == sym["symbol_id"] and s["symbol_type"] in FUNCTION_TYPES]
        for m in sorted(methods, key=lambda s: s["start_line"] or 0):
            add_related("method", m)
        for ref in refs:
            if ref["kind"] == "subclass":
                add_related("subclass", index.symbols[ref["context"]["symbol_id"]])
        for base in sym["bases"]:
            candidates = index.classes_by_name.get(callee_short_name(base), [])
            if len(candidates) == 1:
                add_related("base_class", index.symbols[candidates[0]])
        # Direct callers of the class's methods are also affected by changes to the class
        method_ids = {m["symbol_id"] for m in methods}
        method_callers = []
        for call in index.calls:
            candidates = index.call_candidates(call["short"])
            if len(candidates) == 1 and candidates[0] in method_ids:
                ctx = _caller_context(index, call["caller_id"])
                if ctx and not ctx.get("stale") and ctx["symbol_id"] not in method_ids:
                    method_callers.append(ctx)
        for caller in _unique_symbols(method_callers):
            related.append({"relation": "method_caller", "symbol": caller})
    else:
        if sym["parent_id"] and sym["parent_id"] in index.symbols:
            parent = index.symbols[sym["parent_id"]]
            add_related("parent_class" if parent["symbol_type"] == "class" else "enclosing_function", parent)
        callees = [
            index.symbols[c["target"]["symbol_id"]]
            for c in _outgoing_calls(index, sym)
            if c["confidence"] == "resolved" and c["target"]["symbol_id"] != sym["symbol_id"]
        ]
        for callee in _unique_symbols(callees):
            add_related("calls", callee)

    _attach_snippets(index, refs)
    return {
        "symbol": _summary(sym),
        "references": refs,
        "callers": callers,
        "module_level_uses": module_level_uses,
        "related": related,
        "files": _group_by_file(refs),
        "notice": STATIC_NOTICE,
    }


def file_impact(index: ProjectIndex, relative_path: str) -> dict:
    rel = (relative_path or "").strip().replace("\\", "/")
    if rel not in index.file_ids:
        raise FileNotIndexed(rel)

    imports_from = {}
    imported_by = {}
    external_modules = Counter()
    for imp in index.imports:
        target = index.import_target(imp)
        if imp["relative_path"] == rel:
            if target and target != rel:
                entry = imports_from.setdefault(target, {"relative_path": target, "file_id": index.file_ids[target], "lines": []})
                entry["lines"].append(imp["line"])
            elif target is None:
                external_modules[imp["module"] or imp["name"]] += 1
        elif target == rel:
            entry = imported_by.setdefault(imp["relative_path"], {"relative_path": imp["relative_path"], "file_id": imp["file_id"], "lines": []})
            entry["lines"].append(imp["line"])

    # Directly connected functions: uniquely resolved calls crossing this file's boundary
    incoming = {}
    outgoing = {}
    for call in index.calls:
        candidates = index.call_candidates(call["short"])
        if len(candidates) != 1:
            continue
        target = index.symbols[candidates[0]]
        site = {
            "relative_path": call["relative_path"],
            "file_id": call["file_id"],
            "line": call["line"],
            "caller": _caller_context(index, call["caller_id"]),
        }
        if target["relative_path"] == rel and call["relative_path"] != rel:
            incoming.setdefault(target["symbol_id"], {"symbol": _summary(target), "call_sites": []})["call_sites"].append(site)
        elif call["relative_path"] == rel and target["relative_path"] != rel:
            outgoing.setdefault(target["symbol_id"], {"symbol": _summary(target), "call_sites": []})["call_sites"].append(site)

    def finish(groups):
        result = []
        for g in groups.values():
            g["call_sites"] = _sort_locations(g["call_sites"])
            result.append(g)
        return sorted(result, key=lambda g: (g["symbol"]["relative_path"], g["symbol"]["start_line"] or 0))

    def finish_files(groups):
        return [{**g, "lines": sorted(g["lines"])} for g in sorted(groups.values(), key=lambda g: g["relative_path"])]

    defined = [s for s in index.symbols.values() if s["relative_path"] == rel]
    return {
        "relative_path": rel,
        "file_id": index.file_ids[rel],
        "imports_from": finish_files(imports_from),
        "imported_by": finish_files(imported_by),
        "external_imports": sorted(external_modules),
        "incoming_calls": finish(incoming),
        "outgoing_calls": finish(outgoing),
        "symbol_count": len(defined),
        "notice": STATIC_NOTICE,
    }


# ---------------------------------------------------------------------------
# 4. Potentially Unused Symbols
# ---------------------------------------------------------------------------

def _is_decorated(lines: list, start_line: int) -> bool:
    """
    True if the def/class at start_line (1-based, the 'def' line as reported by ast)
    has decorators directly above it. Multi-line decorator arguments are skipped over.
    """
    if not start_line or start_line > len(lines):
        return False
    def_line = lines[start_line - 1]
    def_indent = len(def_line) - len(def_line.lstrip())
    i = start_line - 2
    while i >= 0:
        line = lines[i]
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            return False
        indent = len(line) - len(line.lstrip())
        if stripped.startswith("@") and indent == def_indent:
            return True
        if indent > def_indent or stripped[0] in ")]}":
            # continuation of a multi-line decorator call
            i -= 1
            continue
        return False
    return False


def _exclusion_reason(index: ProjectIndex, sym: dict, lines: list):
    name = sym["name"]
    basename = os.path.basename(sym["relative_path"])

    if sym["symbol_type"] == "nested_function":
        return "nested_function"
    if name.startswith("__") and name.endswith("__"):
        return "special_method"
    if name in _ENTRY_POINT_NAMES or basename in _ENTRY_POINT_FILES:
        return "entry_point"
    if basename.startswith("test_") or basename.endswith("_test.py") or name.startswith("test") or name.startswith("Test") or name in _TEST_HOOK_NAMES:
        return "test"
    if _is_decorated(lines, sym["start_line"]):
        return "decorated"

    parent = index.symbols.get(sym["parent_id"]) if sym["parent_id"] else None
    if parent is not None and parent["symbol_type"] == "class" and sym["symbol_type"] in FUNCTION_TYPES:
        for base in parent["bases"]:
            base_name = callee_short_name(base)
            if base_name == "object":
                continue
            base_ids = index.classes_by_name.get(base_name, [])
            if not base_ids:
                # External base class (framework, stdlib): methods are likely hooks it calls
                return "framework_hook"
            if any(name in index.method_names_by_class.get(base_id, ()) for base_id in base_ids):
                return "override"
    return None


def potentially_unused(index: ProjectIndex) -> dict:
    sources = index.load_sources()
    lines_by_file = {file_id: source.split("\n") for file_id, source in sources.items()}

    # Every identifier occurrence in the project (code, comments and strings alike, which
    # deliberately errs towards "used"). A name that occurs only at its definitions has
    # no visible use anywhere.
    identifier_counts = Counter()
    for source in sources.values():
        identifier_counts.update(_IDENTIFIER_RE.findall(source))
    definition_counts = Counter(s["name"] for s in index.symbols.values())
    # Recursive self-calls are not evidence of use from elsewhere
    def is_self_call(call):
        caller = index.symbols.get(call["caller_id"]) if call["caller_id"] else None
        return caller is not None and caller["name"] == call["short"]

    self_calls = Counter(c["caller_id"] for c in index.calls if is_self_call(c))
    called_names = Counter(c["short"] for c in index.calls if not is_self_call(c))
    imported_names = {imp["name"] for imp in index.imports} | {imp["alias"] for imp in index.imports if imp["alias"]}
    base_names = {callee_short_name(b) for s in index.symbols.values() for b in s["bases"]}

    findings = []
    excluded = Counter()
    analyzed = 0
    for sym in index.symbols.values():
        if sym["symbol_type"] not in FUNCTION_TYPES and sym["symbol_type"] != "class":
            continue
        lines = lines_by_file.get(sym["file_id"], [])
        reason = _exclusion_reason(index, sym, lines)
        if reason:
            excluded[reason] += 1
            continue
        analyzed += 1

        name = sym["name"]
        if called_names[name] or name in imported_names or name in base_names:
            continue
        other_mentions = identifier_counts[name] - definition_counts[name] - self_calls[sym["symbol_id"]]
        if other_mentions > 0:
            continue

        findings.append({
            "symbol": _summary(sym),
            "label": "Potentially unused",
            "reason": f"No calls, imports, subclasses or other mentions of '{name}' found outside its definition.",
        })

    findings.sort(key=lambda f: (f["symbol"]["relative_path"], f["symbol"]["start_line"] or 0))
    return {
        "findings": findings,
        "analyzed_count": analyzed,
        "excluded": dict(excluded),
        "caveat": UNUSED_CAVEAT,
    }
