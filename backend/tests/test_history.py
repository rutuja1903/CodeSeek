"""
test_history.py -- Tests for Milestone 4 file version history:
- Snapshot creation on save (exact bytes)
- GET  /projects/{project_id}/files/versions
- GET  /projects/{project_id}/files/versions/{version_id}
- POST /projects/{project_id}/files/versions/{version_id}/restore

Fully isolated: each test runs with the working directory set to a temporary folder
(so the relative 'codeseek.db' path resolves there) and a temporary history root.
The real backend/codeseek.db and uploaded projects are never touched.
"""

import os
import re
import sys
import codecs
import pytest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(THIS_DIR, "..")
sys.path.insert(0, BACKEND_DIR)

from app.main import app
from app.services import history
from app.services.indexer import index_project

client = TestClient(app)

REAL_DB = os.path.abspath(os.path.join(BACKEND_DIR, "codeseek.db"))
ORIGINAL_APP_BYTES = b"def original():\r\n    return 1\r\n"
ORIGINAL_HELPER_BYTES = codecs.BOM_UTF8 + b"def helper():\n    return 'h'\n"


def _real_db_state():
    if not os.path.exists(REAL_DB):
        return None
    st = os.stat(REAL_DB)
    return (st.st_size, st.st_mtime_ns)


@pytest.fixture
def env(tmp_path, monkeypatch):
    real_db_before = _real_db_state()

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(history, "HISTORY_ROOT", str(tmp_path / "history"))

    repo = tmp_path / "repo"
    repo.mkdir()
    app_py = repo / "app.py"
    helper_py = repo / "helper.py"
    app_py.write_bytes(ORIGINAL_APP_BYTES)
    helper_py.write_bytes(ORIGINAL_HELPER_BYTES)

    pid = index_project("history_test_project", str(repo))
    assert os.path.isfile(tmp_path / "codeseek.db"), "test DB must live in the temp directory"

    yield SimpleNamespace(tmp=tmp_path, repo=repo, pid=pid, app_py=app_py, helper_py=helper_py)

    assert _real_db_state() == real_db_before, "real codeseek.db must not be modified"


def save(pid, rel, source):
    return client.post(f"/projects/{pid}/files/save", json={"relative_path": rel, "source": source})


def list_versions(pid, rel):
    res = client.get(f"/projects/{pid}/files/versions", params={"relative_path": rel})
    assert res.status_code == 200, res.text
    return res.json()["versions"]


def preview(pid, rel, version_id):
    return client.get(f"/projects/{pid}/files/versions/{version_id}", params={"relative_path": rel})


def restore(pid, rel, version_id):
    return client.post(f"/projects/{pid}/files/versions/{version_id}/restore", json={"relative_path": rel})


# ---------------------------------------------------------------------------
# Snapshots on save
# ---------------------------------------------------------------------------

def test_save_creates_snapshot_of_previous_bytes(env):
    res = save(env.pid, "app.py", "def changed():\n    return 2\n")
    assert res.status_code == 200
    data = res.json()

    versions = list_versions(env.pid, "app.py")
    assert len(versions) == 1
    assert versions[0]["reason"] == "save"
    assert versions[0]["relative_path"] == "app.py"
    assert versions[0]["created_at"]
    assert data["backup_version_id"] == versions[0]["version_id"]

    # Exact bytes, including CRLF line endings
    _, raw = history.get_version(env.pid, "app.py", versions[0]["version_id"])
    assert raw == ORIGINAL_APP_BYTES


def test_snapshot_preserves_bom_exactly(env):
    assert save(env.pid, "helper.py", "def helper():\n    return 'changed'\n").status_code == 200
    version_id = list_versions(env.pid, "helper.py")[0]["version_id"]
    _, raw = history.get_version(env.pid, "helper.py", version_id)
    assert raw == ORIGINAL_HELPER_BYTES


def test_identical_content_is_not_snapshotted_twice(env):
    for _ in range(3):
        assert save(env.pid, "app.py", "x = 1\n").status_code == 200
    # original bytes, then "x = 1" once; later identical backups are deduplicated
    assert len(list_versions(env.pid, "app.py")) == 2


# ---------------------------------------------------------------------------
# Listing and preview
# ---------------------------------------------------------------------------

def test_list_versions_is_scoped_to_the_file(env):
    save(env.pid, "app.py", "a = 1\n")
    save(env.pid, "app.py", "a = 2\n")
    save(env.pid, "helper.py", "b = 1\n")

    app_versions = list_versions(env.pid, "app.py")
    helper_versions = list_versions(env.pid, "helper.py")
    assert len(app_versions) == 2
    assert len(helper_versions) == 1
    assert all(v["relative_path"] == "app.py" for v in app_versions)
    # Newest first
    assert app_versions[0]["version_id"] > app_versions[1]["version_id"]


def test_list_versions_empty_for_unedited_file(env):
    assert list_versions(env.pid, "app.py") == []


def test_preview_returns_source_and_metadata(env):
    save(env.pid, "app.py", "def changed():\n    return 2\n")
    version_id = list_versions(env.pid, "app.py")[0]["version_id"]

    res = preview(env.pid, "app.py", version_id)
    assert res.status_code == 200
    data = res.json()
    assert data["version_id"] == version_id
    assert data["source"] == "def original():\n    return 1\n"
    assert data["line_endings"] == "crlf"
    assert data["has_bom"] is False
    assert data["decode_errors"] is False
    assert data["line_count"] == 2


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------

def test_restore_writes_exact_bytes_and_reindexes(env):
    save(env.pid, "app.py", "def changed():\n    return 2\n")
    version_id = list_versions(env.pid, "app.py")[0]["version_id"]

    res = restore(env.pid, "app.py", version_id)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["reindexed"] is True
    assert data["restored_version_id"] == version_id
    assert data["new_file_id"] is not None

    assert env.app_py.read_bytes() == ORIGINAL_APP_BYTES

    by_path = client.get(f"/projects/{env.pid}/files/by-path", params={"relative_path": "app.py"}).json()
    assert by_path["id"] == data["new_file_id"]
    assert any(s["name"] == "original" for s in by_path["symbols"])
    assert not any(s["name"] == "changed" for s in by_path["symbols"])


def test_restore_preserves_current_version_and_can_be_undone(env):
    save(env.pid, "app.py", "def second():\n    return 2\n")
    second_bytes = env.app_py.read_bytes()
    original_id = list_versions(env.pid, "app.py")[0]["version_id"]

    res = restore(env.pid, "app.py", original_id)
    assert res.status_code == 200
    backup_id = res.json()["backup_version_id"]
    assert backup_id is not None and backup_id != original_id

    versions = list_versions(env.pid, "app.py")
    assert versions[0]["version_id"] == backup_id
    assert versions[0]["reason"] == "restore"

    # Undo the restore by restoring the backup
    assert restore(env.pid, "app.py", backup_id).status_code == 200
    assert env.app_py.read_bytes() == second_bytes


def test_restore_reindex_failure_returns_207_with_file_restored(env):
    save(env.pid, "app.py", "def changed():\n    return 2\n")
    version_id = list_versions(env.pid, "app.py")[0]["version_id"]

    with patch("app.main.index_project", side_effect=RuntimeError("Simulated indexer crash")):
        res = restore(env.pid, "app.py", version_id)

    assert res.status_code == 207
    data = res.json()
    assert data["saved"] is True
    assert data["reindexed"] is False
    assert data["status"] == "reindex_failed"
    assert data["restored_version_id"] == version_id
    assert "restored" in data["message"].lower()
    assert data["recovery"]["file_persisted_on_disk"] is True
    assert env.app_py.read_bytes() == ORIGINAL_APP_BYTES


# ---------------------------------------------------------------------------
# Access control and input validation
# ---------------------------------------------------------------------------

def test_cross_project_and_cross_file_access_rejected(env):
    other_repo = env.tmp / "other_repo"
    other_repo.mkdir()
    (other_repo / "app.py").write_bytes(b"other = True\n")
    other_pid = index_project("history_other_project", str(other_repo))

    save(env.pid, "app.py", "def changed():\n    return 2\n")
    version_id = list_versions(env.pid, "app.py")[0]["version_id"]

    # Same relative path, different project
    assert preview(other_pid, "app.py", version_id).status_code == 404
    assert restore(other_pid, "app.py", version_id).status_code == 404
    assert (other_repo / "app.py").read_bytes() == b"other = True\n"

    # Same project, different file
    helper_before = env.helper_py.read_bytes()
    assert preview(env.pid, "helper.py", version_id).status_code == 404
    assert restore(env.pid, "helper.py", version_id).status_code == 404
    assert env.helper_py.read_bytes() == helper_before


@pytest.mark.parametrize("bad_id", ["not-a-version", "....", "1234", "0000000000000000-ZZZZZZZZZZZZ", "0000000000000000-abc"])
def test_invalid_version_ids_rejected(env, bad_id):
    assert preview(env.pid, "app.py", bad_id).status_code == 400
    assert restore(env.pid, "app.py", bad_id).status_code == 400
    assert env.app_py.read_bytes() == ORIGINAL_APP_BYTES


def test_unknown_version_and_project_return_404(env):
    missing = "0000000000000001-000000000000"
    assert preview(env.pid, "app.py", missing).status_code == 404
    assert restore(env.pid, "app.py", missing).status_code == 404
    assert client.get("/projects/999999/files/versions", params={"relative_path": "app.py"}).status_code == 404


@pytest.mark.parametrize("bad_path,expected", [
    ("../../evil.py", (403, 404)),
    ("/etc/passwd.py", (400,)),
    ("C:\\Windows\\evil.py", (400,)),
    ("config.json", (400,)),
    ("", (400, 422)),
])
def test_unsafe_paths_rejected(env, bad_path, expected):
    res = client.get(f"/projects/{env.pid}/files/versions", params={"relative_path": bad_path})
    assert res.status_code in expected
    res = restore(env.pid, bad_path, "0000000000000001-000000000000")
    assert res.status_code in expected


def test_storage_paths_never_derived_from_user_paths(env):
    save(env.pid, "app.py", "a = 1\n")
    save(env.pid, "helper.py", "b = 1\n")

    root = history.HISTORY_ROOT
    assert not os.path.commonpath([root, str(env.repo)]) == str(env.repo)
    for dirpath, dirnames, filenames in os.walk(root):
        for d in dirnames:
            assert re.fullmatch(r"\d+|[0-9a-f]{64}", d), d
        for f in filenames:
            assert re.fullmatch(r"\d{16}-[0-9a-f]{12}\.(snapshot|json)", f), f


def test_history_files_are_not_indexed(env):
    save(env.pid, "app.py", "a = 1\n")
    files = client.get(f"/projects/{env.pid}/files").json()
    assert sorted(f["relative_path"] for f in files) == ["app.py", "helper.py"]
    assert not any(name.endswith((".snapshot", ".json")) for name in os.listdir(env.repo))


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------

def test_retention_keeps_latest_ten_versions(env):
    for i in range(13):
        assert save(env.pid, "app.py", f"value = {i}\n").status_code == 200

    versions = list_versions(env.pid, "app.py")
    assert len(versions) == history.MAX_VERSIONS_PER_FILE

    # Newest backup is the content before the last save; the oldest ones were pruned
    assert preview(env.pid, "app.py", versions[0]["version_id"]).json()["source"] == "value = 11\n"
    assert preview(env.pid, "app.py", versions[-1]["version_id"]).json()["source"] == "value = 2\n"

    # Only snapshot pairs remain on disk; project files are untouched by cleanup
    file_dir = history._file_dir(env.pid, "app.py")
    assert len(os.listdir(file_dir)) == 2 * history.MAX_VERSIONS_PER_FILE
    assert env.app_py.read_text(encoding="utf-8") == "value = 12\n"
    assert env.helper_py.read_bytes() == ORIGINAL_HELPER_BYTES


# ---------------------------------------------------------------------------
# Failure safety
# ---------------------------------------------------------------------------

def test_failed_snapshot_aborts_save_and_keeps_file(env):
    with patch("app.main.history.create_snapshot", side_effect=OSError("history disk full")):
        res = save(env.pid, "app.py", "def changed():\n    return 2\n")
    assert res.status_code == 500
    assert "not saved" in res.json()["detail"]
    assert env.app_py.read_bytes() == ORIGINAL_APP_BYTES
    assert list_versions(env.pid, "app.py") == []


def test_failed_restore_write_keeps_current_file(env):
    save(env.pid, "app.py", "def changed():\n    return 2\n")
    current_bytes = env.app_py.read_bytes()
    version_id = list_versions(env.pid, "app.py")[0]["version_id"]

    real_write = history.atomic_write_bytes

    def fail_on_project_file(path, data):
        if os.path.abspath(path) == os.path.abspath(env.app_py):
            raise OSError("Simulated disk failure")
        return real_write(path, data)

    with patch.object(history, "atomic_write_bytes", side_effect=fail_on_project_file):
        res = restore(env.pid, "app.py", version_id)

    assert res.status_code == 500
    assert "unchanged" in res.json()["detail"]
    assert env.app_py.read_bytes() == current_bytes
    assert not any(name.endswith(".tmp") for name in os.listdir(env.repo))


def test_corrupted_snapshot_is_not_restored(env):
    save(env.pid, "app.py", "def changed():\n    return 2\n")
    current_bytes = env.app_py.read_bytes()
    version_id = list_versions(env.pid, "app.py")[0]["version_id"]

    snapshot_path = os.path.join(history._file_dir(env.pid, "app.py"), f"{version_id}.snapshot")
    with open(snapshot_path, "wb") as f:
        f.write(b"tampered = True\n")

    assert preview(env.pid, "app.py", version_id).status_code == 409
    assert restore(env.pid, "app.py", version_id).status_code == 409
    assert env.app_py.read_bytes() == current_bytes
