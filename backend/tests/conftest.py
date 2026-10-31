"""
conftest.py -- Session-wide isolation for the CodeSeek test suite.

The application opens 'codeseek.db' relative to the current working directory and
writes uploads and version history under backend/. Before any test (or module
fixture) runs, this switches the working directory to a temporary folder and points
the uploads and history roots there too, so the real backend/codeseek.db, uploaded
projects and version history are never read, modified or deleted by tests.
"""

import os
import sys

import pytest

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(THIS_DIR, ".."))
sys.path.insert(0, BACKEND_DIR)

from app import main  # noqa: E402
from app.services import history  # noqa: E402

REAL_DB = os.path.join(BACKEND_DIR, "codeseek.db")
REAL_DATA_DIRS = [os.path.join(BACKEND_DIR, "uploads"), os.path.join(BACKEND_DIR, "version_history")]


def _real_data_state():
    """Fingerprint of the real application data (DB stat + file listing of data dirs)."""
    state = {}
    if os.path.exists(REAL_DB):
        st = os.stat(REAL_DB)
        state["db"] = (st.st_size, st.st_mtime_ns)
    for root in REAL_DATA_DIRS:
        for dirpath, _, files in os.walk(root):
            for name in files:
                path = os.path.join(dirpath, name)
                st = os.stat(path)
                state[path] = (st.st_size, st.st_mtime_ns)
    return state


@pytest.fixture(scope="session", autouse=True)
def isolated_app_data(tmp_path_factory):
    before = _real_data_state()
    data_dir = tmp_path_factory.mktemp("codeseek_data")

    mp = pytest.MonkeyPatch()
    mp.chdir(data_dir)
    mp.setattr(main, "_UPLOADS_ROOT", str(data_dir / "uploads"))
    mp.setattr(history, "HISTORY_ROOT", str(data_dir / "history"))
    try:
        yield data_dir
    finally:
        mp.undo()

    assert _real_data_state() == before, "tests must not modify the real codeseek.db, uploads or version history"
