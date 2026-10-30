"""
test_analysis.py -- Tests for Milestone 5 code intelligence:
- GET /projects/{project_id}/analysis/references
- GET /projects/{project_id}/analysis/call-hierarchy
- GET /projects/{project_id}/analysis/impact
- GET /projects/{project_id}/analysis/file-impact
- GET /projects/{project_id}/analysis/unused

Fully isolated: the working directory is a temporary folder (so the relative
'codeseek.db' path resolves there) and projects are temporary directories.
The real backend/codeseek.db and uploaded projects are never touched.
"""

import os
import sys
import textwrap
import pytest
from types import SimpleNamespace
from fastapi.testclient import TestClient

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(THIS_DIR, "..")
sys.path.insert(0, BACKEND_DIR)

from app.main import app
from app.services import history
from app.services.indexer import index_project
from app.database.core import get_connection

client = TestClient(app)

REAL_DB = os.path.abspath(os.path.join(BACKEND_DIR, "codeseek.db"))

PROJECT_FILES = {
    "pkg/__init__.py": """
        from pkg.models import User
    """,
    "pkg/models.py": """
        class Base:
            def save(self):
                return True


        class User(Base):
            def __init__(self, name):
                self.name = name

            def save(self):
                return super().save()

            def display(self):
                return format_name(self.name)


        def format_name(value):
            return value.title()


        def orphan_helper():
            return 1


        class OrphanClass:
            pass
    """,
    "services.py": """
        from pkg.models import User, format_name
        from pkg.models import format_name as fmt
        from external_lib import ExternalBase


        def route(fn):
            return fn


        def register(name):
            user = User(name)
            user.save()
            user.display()
            return fmt(name)


        def unused_service():
            return register("x")


        @route
        def handler():
            return format_name("y")


        def recursive_unused(n):
            if n:
                return recursive_unused(n - 1)
            return 0


        def callback_target():
            return 1


        CALLBACKS = [callback_target]


        class Plugin(ExternalBase):
            def on_event(self):
                return None
    """,
    "other.py": """
        from pkg import User


        def make():
            return User("z")
    """,
    "main.py": """
        from services import register
        from other import make


        def main():
            register("a")
            make()


        if __name__ == "__main__":
            main()
    """,
    "test_sample.py": """
        def test_sample():
            assert True


        class TestThing:
            def test_method(self):
                assert True
    """,
}


def _real_db_state():
    if not os.path.exists(REAL_DB):
        return None
    st = os.stat(REAL_DB)
    return (st.st_size, st.st_mtime_ns)


def _write_project(root, files):
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")


@pytest.fixture
def env(tmp_path, monkeypatch):
    real_db_before = _real_db_state()

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(history, "HISTORY_ROOT", str(tmp_path / "history"))

    repo = tmp_path / "repo"
    _write_project(repo, PROJECT_FILES)
    pid = index_project("analysis_test_project", str(repo))
    assert os.path.isfile(tmp_path / "codeseek.db"), "test DB must live in the temp directory"

    yield SimpleNamespace(tmp=tmp_path, repo=repo, pid=pid)

    assert _real_db_state() == real_db_before, "real codeseek.db must not be modified"


def line_of(env, rel, text, occurrence=1):
    """1-based line number of the n-th line containing text."""
    found = 0
    for i, line in enumerate((env.repo / rel).read_text(encoding="utf-8").split("\n"), start=1):
        if text in line:
            found += 1
            if found == occurrence:
                return i
    raise AssertionError(f"{text!r} not found in {rel}")


def get(env, endpoint, **params):
    return client.get(f"/projects/{env.pid}/analysis/{endpoint}", params=params)


def locations(items):
    return {(item["relative_path"], item["line"]) for item in items}


# ---------------------------------------------------------------------------
# Find References
# ---------------------------------------------------------------------------

def test_function_references_across_files(env):
    res = get(env, "references", symbol_id="pkg/models.py::format_name")
    assert res.status_code == 200
    refs = res.json()["references"]

    calls = [r for r in refs if r["kind"] == "call"]
    imports = [r for r in refs if r["kind"] == "import"]

    assert locations(calls) == {
        ("pkg/models.py", line_of(env, "pkg/models.py", "return format_name(self.name)")),
        ("services.py", line_of(env, "services.py", 'return format_name("y")')),
        # Call through the 'fmt' alias
        ("services.py", line_of(env, "services.py", "return fmt(name)")),
    }
    assert all(r["confidence"] == "resolved" for r in calls)
    assert locations(imports) == {
        ("services.py", line_of(env, "services.py", "import User, format_name")),
        ("services.py", line_of(env, "services.py", "import format_name as fmt")),
    }

    # Caller context and source snippet
    display_call = next(r for r in calls if r["relative_path"] == "pkg/models.py")
    assert display_call["context"]["symbol_id"] == "pkg/models.py::User.display"
    assert display_call["snippet"] == "return format_name(self.name)"

    # The definition itself is never reported
    def_line = line_of(env, "pkg/models.py", "def format_name")
    assert ("pkg/models.py", def_line) not in locations(refs)


def test_class_references_include_instantiation_imports_reexports_and_subclasses(env):
    refs = get(env, "references", symbol_id="pkg/models.py::User").json()["references"]
    by_kind = {}
    for r in refs:
        by_kind.setdefault(r["kind"], set()).add((r["relative_path"], r["line"]))

    assert by_kind["instantiation"] == {
        ("services.py", line_of(env, "services.py", "user = User(name)")),
        ("other.py", line_of(env, "other.py", 'return User("z")')),
    }
    assert by_kind["import"] == {
        ("pkg/__init__.py", 1),
        ("services.py", line_of(env, "services.py", "import User, format_name")),
        # Imported through the package __init__ re-export
        ("other.py", line_of(env, "other.py", "from pkg import User")),
    }

    base_refs = get(env, "references", symbol_id="pkg/models.py::Base").json()["references"]
    subclass = [r for r in base_refs if r["kind"] == "subclass"]
    assert locations(subclass) == {("pkg/models.py", line_of(env, "pkg/models.py", "class User(Base)"))}
    assert subclass[0]["context"]["symbol_id"] == "pkg/models.py::User"


def test_ambiguous_method_references_are_labelled(env):
    refs = get(env, "references", symbol_id="pkg/models.py::Base.save").json()["references"]
    save_call = next(r for r in refs if r["line"] == line_of(env, "services.py", "user.save()"))
    assert save_call["confidence"] == "ambiguous"


# ---------------------------------------------------------------------------
# Call Hierarchy
# ---------------------------------------------------------------------------

def test_call_hierarchy_incoming_and_outgoing(env):
    res = get(env, "call-hierarchy", symbol_id="services.py::register")
    assert res.status_code == 200
    data = res.json()

    incoming = {(c["context"]["symbol_id"] if c["context"] else None, c["relative_path"], c["line"]) for c in data["incoming"]}
    assert incoming == {
        ("main.py::main", "main.py", line_of(env, "main.py", 'register("a")')),
        ("services.py::unused_service", "services.py", line_of(env, "services.py", 'return register("x")')),
    }

    outgoing = {c["callee"]: c for c in data["outgoing"]}
    assert outgoing["User"]["confidence"] == "resolved"
    assert outgoing["User"]["target"]["symbol_id"] == "pkg/models.py::User"
    assert outgoing["User"]["line"] == line_of(env, "services.py", "user = User(name)")
    assert outgoing["user.display"]["target"]["symbol_id"] == "pkg/models.py::User.display"
    assert outgoing["fmt"]["target"]["symbol_id"] == "pkg/models.py::format_name"

    save = outgoing["user.save"]
    assert save["confidence"] == "ambiguous"
    assert {c["symbol_id"] for c in save["candidates"]} == {"pkg/models.py::Base.save", "pkg/models.py::User.save"}


def test_call_hierarchy_module_level_and_unresolved(env):
    data = get(env, "call-hierarchy", symbol_id="main.py::main").json()
    assert [(c["context"], c["relative_path"], c["line"]) for c in data["incoming"]] == [
        (None, "main.py", line_of(env, "main.py", "    main()", occurrence=1))
    ]

    data = get(env, "call-hierarchy", symbol_id="pkg/models.py::format_name").json()
    title = next(c for c in data["outgoing"] if c["callee"] == "value.title")
    assert title["confidence"] == "unresolved"
    assert title["target"] is None


def test_call_hierarchy_rejects_classes(env):
    assert get(env, "call-hierarchy", symbol_id="pkg/models.py::User").status_code == 400


# ---------------------------------------------------------------------------
# Change Impact
# ---------------------------------------------------------------------------

def test_function_impact(env):
    data = get(env, "impact", symbol_id="pkg/models.py::format_name").json()
    assert {c["symbol_id"] for c in data["callers"]} == {
        "pkg/models.py::User.display",
        "services.py::handler",
        "services.py::register",
    }
    assert {f["relative_path"] for f in data["files"]} == {"pkg/models.py", "services.py"}
    services = next(f for f in data["files"] if f["relative_path"] == "services.py")
    assert services["kinds"] == {"call": 2, "import": 2}
    assert "static" in data["notice"].lower()

    register = get(env, "impact", symbol_id="services.py::register").json()
    related = {(r["relation"], r["symbol"]["symbol_id"]) for r in register["related"]}
    assert ("calls", "pkg/models.py::User") in related
    assert ("calls", "pkg/models.py::format_name") in related


def test_class_impact_includes_methods_subclasses_and_method_callers(env):
    data = get(env, "impact", symbol_id="pkg/models.py::User").json()
    related = {(r["relation"], r["symbol"]["symbol_id"]) for r in data["related"]}
    assert ("method", "pkg/models.py::User.display") in related
    assert ("base_class", "pkg/models.py::Base") in related
    assert ("method_caller", "services.py::register") in related
    assert {c["symbol_id"] for c in data["callers"]} == {"services.py::register", "other.py::make"}

    base = get(env, "impact", symbol_id="pkg/models.py::Base").json()
    assert ("subclass", "pkg/models.py::User") in {(r["relation"], r["symbol"]["symbol_id"]) for r in base["related"]}


def test_file_impact_direct_dependencies(env):
    res = get(env, "file-impact", relative_path="services.py")
    assert res.status_code == 200
    data = res.json()

    imports_from = {f["relative_path"]: f["lines"] for f in data["imports_from"]}
    assert imports_from == {"pkg/models.py": [1, 1, 2]}
    assert data["external_imports"] == ["external_lib"]

    imported_by = {f["relative_path"]: f["lines"] for f in data["imported_by"]}
    assert imported_by == {"main.py": [line_of(env, "main.py", "from services import register")]}

    incoming = {g["symbol"]["symbol_id"]: locations(g["call_sites"]) for g in data["incoming_calls"]}
    assert incoming == {"services.py::register": {("main.py", line_of(env, "main.py", 'register("a")'))}}

    outgoing = {g["symbol"]["symbol_id"] for g in data["outgoing_calls"]}
    # 'user.save' is ambiguous and therefore not listed as a direct connection
    assert outgoing == {"pkg/models.py::User", "pkg/models.py::User.display", "pkg/models.py::format_name"}


def test_file_impact_accepts_backslash_paths(env):
    assert get(env, "file-impact", relative_path="pkg\\models.py").status_code == 200


# ---------------------------------------------------------------------------
# Potentially Unused
# ---------------------------------------------------------------------------

def test_potentially_unused_symbols(env):
    res = get(env, "unused")
    assert res.status_code == 200
    data = res.json()

    flagged = {f["symbol"]["symbol_id"] for f in data["findings"]}
    assert flagged == {
        "pkg/models.py::orphan_helper",
        "pkg/models.py::OrphanClass",
        "services.py::unused_service",
        "services.py::recursive_unused",  # only calls itself
        "services.py::Plugin",
    }
    assert all(f["label"] == "Potentially unused" for f in data["findings"])
    assert "false positive" in data["caveat"].lower()

    finding = next(f for f in data["findings"] if f["symbol"]["name"] == "orphan_helper")
    assert finding["symbol"]["start_line"] == line_of(env, "pkg/models.py", "def orphan_helper")


def test_special_methods_entry_points_and_hooks_are_not_flagged(env):
    data = get(env, "unused").json()
    flagged_names = {f["symbol"]["name"] for f in data["findings"]}

    for name in ("__init__", "main", "handler", "route", "callback_target", "save", "on_event", "test_sample", "TestThing", "test_method"):
        assert name not in flagged_names, name

    excluded = data["excluded"]
    assert excluded["special_method"] >= 1   # __init__
    assert excluded["entry_point"] >= 1      # main
    assert excluded["decorated"] >= 1        # @route handler
    assert excluded["override"] >= 1         # User.save overrides Base.save
    assert excluded["framework_hook"] >= 1   # Plugin.on_event on an external base
    assert excluded["test"] >= 1


# ---------------------------------------------------------------------------
# Missing / stale data and project isolation
# ---------------------------------------------------------------------------

def test_missing_symbol_and_file_return_404(env):
    for endpoint in ("references", "call-hierarchy", "impact"):
        res = get(env, endpoint, symbol_id="pkg/models.py::does_not_exist")
        assert res.status_code == 404
        assert "renamed or removed" in res.json()["detail"]
    assert get(env, "file-impact", relative_path="missing.py").status_code == 404
    assert client.get("/projects/999999/analysis/unused").status_code == 404


def test_stale_caller_rows_are_handled(env):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM files WHERE project_id = ? AND relative_path = 'main.py'", (env.pid,))
        file_id = cursor.fetchone()["id"]
        cursor.execute(
            "INSERT INTO calls (project_id, file_id, caller_symbol_id, raw_callee_name, line_number) VALUES (?, ?, ?, ?, ?)",
            (env.pid, file_id, "main.py::removed_function", "format_name", 99),
        )
        conn.commit()
    finally:
        conn.close()

    res = get(env, "references", symbol_id="pkg/models.py::format_name")
    assert res.status_code == 200
    stale = next(r for r in res.json()["references"] if r["line"] == 99)
    assert stale["context"]["stale"] is True
    assert "snippet" not in stale  # line 99 does not exist in the file

    impact = get(env, "impact", symbol_id="pkg/models.py::format_name").json()
    assert "main.py::removed_function" not in {c["symbol_id"] for c in impact["callers"]}


def test_analysis_is_isolated_between_projects(env):
    other_repo = env.tmp / "other_repo"
    _write_project(other_repo, {
        "pkg/models.py": """
            def format_name(value):
                return value


            def use():
                return format_name(1)
        """,
    })
    other_pid = index_project("analysis_other_project", str(other_repo))

    refs = get(env, "references", symbol_id="pkg/models.py::format_name").json()["references"]
    assert ("pkg/models.py", line_of(env, "pkg/models.py", "return format_name(self.name)")) in locations(refs)
    assert len([r for r in refs if r["kind"] == "call"]) == 3

    other = client.get(f"/projects/{other_pid}/analysis/references", params={"symbol_id": "pkg/models.py::format_name"}).json()
    # def format_name (1), return (2), blank (3-4), def use (5), call (6)
    assert [(r["kind"], r["line"]) for r in other["references"]] == [("call", 6)]
    assert all(r["file_id"] != ref["file_id"] for r in other["references"] for ref in refs)

    # Symbols that exist only in the first project are not visible from the second
    res = client.get(f"/projects/{other_pid}/analysis/impact", params={"symbol_id": "pkg/models.py::orphan_helper"})
    assert res.status_code == 404
    other_unused = client.get(f"/projects/{other_pid}/analysis/unused").json()
    assert {f["symbol"]["relative_path"] for f in other_unused["findings"]} <= {"pkg/models.py"}
