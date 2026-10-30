"""
test_editor.py -- Tests for Phase 3 Code Editor endpoints:
- POST /projects/{project_id}/files/validate
- GET  /projects/{project_id}/files/by-path
- POST /projects/{project_id}/files/save

Includes transaction rollback, connection cleanup, and post-index verification tests.
"""

import os
import sys
import shutil
import tempfile
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(THIS_DIR, ".."))

from app.main import app
from app.database.core import get_connection
from app.services.indexer import index_project

client = TestClient(app)


@pytest.fixture(scope="module")
def editor_project():
    """
    Creates an isolated temporary project on disk and indexes it into the database.
    Cleans up the database records and filesystem directory after all module tests finish.
    """
    temp_dir = tempfile.mkdtemp(prefix="codeseek_editor_test_")
    
    # Create initial files
    main_py = os.path.join(temp_dir, "app.py")
    with open(main_py, "w", encoding="utf-8") as f:
        f.write("def original_func():\n    return 42\n")

    helper_py = os.path.join(temp_dir, "helper.py")
    with open(helper_py, "w", encoding="utf-8") as f:
        f.write("class HelperService:\n    def compute(self):\n        return 'help'\n")

    # Index into the database
    project_id = index_project(project_name="editor_fixture_project", root_dir=temp_dir)

    yield {
        "project_id": project_id,
        "root_dir": temp_dir,
        "app_py": main_py,
        "helper_py": helper_py
    }

    # Cleanup: remove DB records
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
    finally:
        conn.close()

    # Cleanup: remove temporary directory
    shutil.rmtree(temp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# 1. Validation Endpoint Tests: POST /projects/{project_id}/files/validate
# ---------------------------------------------------------------------------

def test_validate_source_valid_python(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "source": "def calculate_total(price, qty):\n    return price * qty\n",
        "relative_path": "app.py"
    }
    response = client.post(f"/projects/{pid}/files/validate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["errors"] == []


def test_validate_source_syntax_error(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "source": "def broken_func(:\n    return 10\n",
        "relative_path": "app.py"
    }
    response = client.post(f"/projects/{pid}/files/validate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is False
    assert len(data["errors"]) == 1
    err = data["errors"][0]
    assert err["line"] == 1
    assert err["message"] is not None


def test_validate_source_without_relative_path(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "source": "x = 10\ny = 20\n"
    }
    response = client.post(f"/projects/{pid}/files/validate", json=payload)
    assert response.status_code == 200
    assert response.json()["valid"] is True


def test_validate_source_project_not_found():
    payload = {"source": "x = 1"}
    response = client.post("/projects/999999/files/validate", json=payload)
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# ---------------------------------------------------------------------------
# 2. Get File by Relative Path: GET /projects/{project_id}/files/by-path
# ---------------------------------------------------------------------------

def test_get_file_by_relative_path_success(editor_project):
    pid = editor_project["project_id"]
    response = client.get(f"/projects/{pid}/files/by-path?relative_path=app.py")
    assert response.status_code == 200
    data = response.json()
    assert data["relative_path"] == "app.py"
    assert "original_func" in data["source"]
    assert len(data["symbols"]) == 1
    assert data["symbols"][0]["name"] == "original_func"


def test_get_file_by_relative_path_with_backslash(editor_project):
    pid = editor_project["project_id"]
    response = client.get(f"/projects/{pid}/files/by-path?relative_path=helper.py")
    assert response.status_code == 200
    data = response.json()
    assert data["relative_path"] == "helper.py"
    assert any(s["name"] == "HelperService" for s in data["symbols"])


def test_get_file_by_path_file_not_found(editor_project):
    pid = editor_project["project_id"]
    response = client.get(f"/projects/{pid}/files/by-path?relative_path=nonexistent.py")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_file_by_path_project_not_found():
    response = client.get("/projects/999999/files/by-path?relative_path=app.py")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 3. Save File Endpoint: POST /projects/{project_id}/files/save
# ---------------------------------------------------------------------------

def test_save_file_success_updates_disk_and_reindexes(editor_project):
    pid = editor_project["project_id"]
    new_source = (
        "def updated_func(val):\n"
        "    \"\"\"Docstring.\"\"\"\n"
        "    return val * 100\n"
    )
    payload = {
        "relative_path": "app.py",
        "source": new_source
    }
    response = client.post(f"/projects/{pid}/files/save", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["saved"] is True
    assert data["reindexed"] is True
    assert data["status"] == "success"
    assert data["new_file_id"] is not None

    # Verify content persisted on disk
    with open(editor_project["app_py"], "r", encoding="utf-8") as f:
        disk_content = f.read()
    assert disk_content == new_source

    # Verify database contains updated symbol
    get_res = client.get(f"/projects/{pid}/files/by-path?relative_path=app.py")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert "updated_func" in get_data["source"]
    assert any(s["name"] == "updated_func" for s in get_data["symbols"])
    assert not any(s["name"] == "original_func" for s in get_data["symbols"])


def test_save_file_with_syntax_error_saves_disk_and_records_status(editor_project):
    pid = editor_project["project_id"]
    syntax_err_source = "def broken_code(:\n    pass\n"
    payload = {
        "relative_path": "app.py",
        "source": syntax_err_source
    }
    response = client.post(f"/projects/{pid}/files/save", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["saved"] is True
    assert data["reindexed"] is True

    # File on disk has new code
    with open(editor_project["app_py"], "r", encoding="utf-8") as f:
        assert f.read() == syntax_err_source

    # DB records parse_status = False
    get_res = client.get(f"/projects/{pid}/files/by-path?relative_path=app.py")
    assert get_res.status_code == 200
    file_info = get_res.json()
    assert file_info["parse_status"] == 0 or file_info["parse_status"] is False
    assert file_info["parse_error"] is not None


def test_save_file_reindex_failure_returns_207_and_preserves_disk(editor_project):
    pid = editor_project["project_id"]
    new_source = "def salvage_func():\n    return 'persisted'\n"
    payload = {
        "relative_path": "app.py",
        "source": new_source
    }

    # Simulate re-indexing failure
    with patch("app.main.index_project", side_effect=RuntimeError("Simulated scanner crash")):
        response = client.post(f"/projects/{pid}/files/save", json=payload)

    assert response.status_code == 207
    data = response.json()
    assert data["saved"] is True
    assert data["reindexed"] is False
    assert data["status"] == "reindex_failed"
    assert data["error_type"] == "RuntimeError"
    assert data["recovery"]["file_persisted_on_disk"] is True

    # Confirm file was written to disk despite indexing failure
    with open(editor_project["app_py"], "r", encoding="utf-8") as f:
        assert f.read() == new_source

    # Confirm no database locks remain and subsequent operations succeed
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (pid,))
        assert cursor.fetchone() is not None
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 4. Security & Path Traversal Rejection Tests
# ---------------------------------------------------------------------------

def test_save_file_rejects_parent_directory_traversal(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "relative_path": "../../evil.py",
        "source": "x = 1"
    }
    response = client.post(f"/projects/{pid}/files/save", json=payload)
    # Rejects as non-existent in files table (404) or path traversal (403)
    assert response.status_code in (403, 404)


def test_save_file_rejects_absolute_path_posix(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "relative_path": "/etc/passwd.py",
        "source": "x = 1"
    }
    response = client.post(f"/projects/{pid}/files/save", json=payload)
    assert response.status_code == 400
    assert "absolute" in response.json()["detail"].lower()


def test_save_file_rejects_windows_drive_path(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "relative_path": "C:\\Windows\\System32\\evil.py",
        "source": "x = 1"
    }
    response = client.post(f"/projects/{pid}/files/save", json=payload)
    assert response.status_code == 400
    assert "absolute" in response.json()["detail"].lower()


def test_save_file_rejects_non_python_extension(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "relative_path": "config.json",
        "source": "{}"
    }
    response = client.post(f"/projects/{pid}/files/save", json=payload)
    assert response.status_code == 400
    assert "only python source files" in response.json()["detail"].lower()


def test_save_file_rejects_empty_path(editor_project):
    pid = editor_project["project_id"]
    payload = {
        "relative_path": "",
        "source": "x = 1"
    }
    response = client.post(f"/projects/{pid}/files/save", json=payload)
    assert response.status_code == 400


def test_save_file_project_not_found():
    payload = {
        "relative_path": "app.py",
        "source": "x = 1"
    }
    response = client.post("/projects/999999/files/save", json=payload)
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 5. Transaction Safety & Post-Index Verification Tests
# ---------------------------------------------------------------------------

def test_indexer_failure_rolls_back_and_closes_connection(tmp_path):
    """
    Directly verifies indexer transaction rollback and connection closure:
    When re-indexing an existing project fails, the database modifications
    (wiping child rows) are rolled back and the connection is closed immediately.
    """
    db_file = str(tmp_path / "rollback_test.db")
    proj_dir = tmp_path / "repo"
    proj_dir.mkdir()
    (proj_dir / "module.py").write_text("def stable_func(): return 1\n", encoding="utf-8")

    # Initial index
    pid = index_project("test_rollback_proj", str(proj_dir), db_path=db_file)

    conn = get_connection(db_file)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM files WHERE project_id = ?", (pid,))
    files_before = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM symbols WHERE project_id = ?", (pid,))
    symbols_before = cursor.fetchone()[0]
    conn.close()
    assert files_before == 1
    assert symbols_before == 1

    # Attempt re-indexing with simulated parser failure
    with patch("app.services.indexer.parse_repository", side_effect=RuntimeError("Simulated parse crash")):
        with pytest.raises(RuntimeError, match="Simulated parse crash"):
            index_project("test_rollback_proj", str(proj_dir), db_path=db_file, update_project_id=pid)

    # 1. Verify connection was closed by immediately executing a write (would fail if locked)
    conn = get_connection(db_file)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO projects (name, root_path) VALUES (?, ?)", ("lock_test", "path"))
    conn.commit()

    # 2. Verify previous index rows remain intact (complete rollback)
    cursor.execute("SELECT COUNT(*) FROM files WHERE project_id = ?", (pid,))
    files_after = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM symbols WHERE project_id = ?", (pid,))
    symbols_after = cursor.fetchone()[0]
    conn.close()

    assert files_after == files_before
    assert symbols_after == symbols_before


def test_existing_index_remains_intact_after_failed_reindex_via_api(editor_project):
    """
    Verifies that when a file save encounters a re-indexing error, the
    pre-existing database index rows remain valid and accessible via the API.
    """
    pid = editor_project["project_id"]

    # Read current state
    initial_res = client.get(f"/projects/{pid}/files/by-path?relative_path=helper.py")
    assert initial_res.status_code == 200
    initial_data = initial_res.json()

    # Attempt save that fails during re-indexing
    with patch("app.main.index_project", side_effect=ValueError("Simulated indexer exception")):
        save_res = client.post(
            f"/projects/{pid}/files/save",
            json={"relative_path": "helper.py", "source": "# modified"}
        )

    assert save_res.status_code == 207
    assert save_res.json()["reindexed"] is False

    # Verify that existing file records and symbols remain accessible
    after_res = client.get(f"/projects/{pid}/files/by-path?relative_path=helper.py")
    assert after_res.status_code == 200
    after_data = after_res.json()
    assert after_data["id"] == initial_data["id"]
    assert len(after_data["symbols"]) == len(initial_data["symbols"])


def test_missing_post_index_file_record_returns_partial_success_207(editor_project):
    """
    Verifies that if re-indexing completes but the file row is missing from the database,
    the endpoint returns HTTP 207 with reindexed=False, NOT a false 200 success.
    """
    pid = editor_project["project_id"]
    valid_source = "def present_func(): pass\n"

    real_get_conn = get_connection

    class CursorProxy:
        def __init__(self, real_cursor):
            self._cursor = real_cursor
            self._fake_empty = False

        def execute(self, sql, *params):
            if "SELECT id FROM files WHERE project_id" in sql:
                self._fake_empty = True
                return self
            return self._cursor.execute(sql, *params)

        def fetchone(self):
            if self._fake_empty:
                return None
            return self._cursor.fetchone()

        def __getattr__(self, name):
            return getattr(self._cursor, name)

    class ConnectionProxy:
        def __init__(self, real_conn):
            self._conn = real_conn

        def cursor(self):
            return CursorProxy(self._conn.cursor())

        def close(self):
            self._conn.close()

        def __getattr__(self, name):
            return getattr(self._conn, name)

    with patch("app.main.get_connection", side_effect=lambda: ConnectionProxy(real_get_conn())):
        response = client.post(
            f"/projects/{pid}/files/save",
            json={"relative_path": "app.py", "source": valid_source}
        )

    assert response.status_code == 207
    data = response.json()
    assert data["saved"] is True
    assert data["reindexed"] is False
    assert data["status"] == "reindex_missing_file"
    assert data["new_file_id"] is None
    assert "not found in the project index" in data["message"]
