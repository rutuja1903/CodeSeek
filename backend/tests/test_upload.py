"""
test_upload.py -- Tests for POST /projects/analyze-upload ZIP upload endpoint.
"""
import io
import os
import sys
import zipfile
import shutil
import tempfile
import pytest
from fastapi.testclient import TestClient

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(THIS_DIR, ".."))

from app.main import app, _UPLOADS_ROOT

client = TestClient(app)

SAMPLE_SHOP = os.path.abspath(
    os.path.join(THIS_DIR, "..", "..", "sample_projects", "sample_shop")
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_zip_from_dir(source_dir: str, with_wrapper: bool = False) -> bytes:
    """
    Create a ZIP archive from source_dir.
    If with_wrapper=True the files are placed inside a top-level folder
    called 'project/' inside the ZIP, simulating a GitHub-export layout.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(source_dir):
            # Skip hidden directories like __pycache__
            dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
            for fname in files:
                full_path = os.path.join(root, fname)
                arcname = os.path.relpath(full_path, source_dir)
                if with_wrapper:
                    arcname = os.path.join("project", arcname)
                zf.write(full_path, arcname)
    return buf.getvalue()


def make_malformed_zip() -> bytes:
    """Return bytes that look like a ZIP header but are corrupted."""
    return b"PK\x03\x04" + b"\x00" * 30 + b"notreallyzipdata"


def make_zip_with_slip_entry() -> bytes:
    """Return a ZIP containing a path-traversal (Zip Slip) entry."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # Safe entry
        zf.writestr("safe.txt", "hello")
        # Malicious traversal entry
        zf.writestr("../../evil.py", "import os; os.system('rm -rf /')")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_upload_valid_zip_indexes_successfully():
    """A valid ZIP of sample_shop should index and return a project_id."""
    zip_bytes = make_zip_from_dir(SAMPLE_SHOP, with_wrapper=False)
    response = client.post(
        "/projects/analyze-upload",
        data={"name": "upload_test_flat"},
        files={"file": ("sample_shop.zip", zip_bytes, "application/zip")},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["message"] == "Project indexed successfully"
    assert "project_id" in data

    pid = data["project_id"]
    overview = client.get(f"/projects/{pid}").json()
    assert overview["counts"]["files"] == 6
    assert overview["counts"]["symbols"] > 0
    assert overview["counts"]["imports"] == 6


def test_upload_zip_with_wrapper_folder():
    """A ZIP whose files sit under one top-level folder should still index correctly."""
    zip_bytes = make_zip_from_dir(SAMPLE_SHOP, with_wrapper=True)
    response = client.post(
        "/projects/analyze-upload",
        data={"name": "upload_test_wrapped"},
        files={"file": ("sample_shop_wrapped.zip", zip_bytes, "application/zip")},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "project_id" in data

    pid = data["project_id"]
    overview = client.get(f"/projects/{pid}").json()
    # Should still resolve to 6 Python files even with wrapper folder
    assert overview["counts"]["files"] == 6


def test_upload_non_zip_rejected():
    """Uploading a file that does not end with .zip must be rejected."""
    response = client.post(
        "/projects/analyze-upload",
        data={"name": "bad_name"},
        files={"file": ("source.tar.gz", b"fake tarball data", "application/gzip")},
    )
    assert response.status_code == 400
    assert "zip" in response.json()["detail"].lower()


def test_upload_malformed_zip_rejected():
    """A file named .zip but not a real ZIP archive must be rejected."""
    response = client.post(
        "/projects/analyze-upload",
        data={"name": "bad_zip"},
        files={"file": ("corrupt.zip", make_malformed_zip(), "application/zip")},
    )
    assert response.status_code == 400
    assert "valid ZIP" in response.json()["detail"]


def test_upload_zip_slip_rejected():
    """ZIP entries containing path traversal sequences must be rejected."""
    response = client.post(
        "/projects/analyze-upload",
        data={"name": "slip_attempt"},
        files={"file": ("evil.zip", make_zip_with_slip_entry(), "application/zip")},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "Zip Slip" in detail or "escape" in detail.lower()


def test_upload_missing_name_rejected():
    """Omitting the 'name' form field should return 422 (FastAPI validation)."""
    zip_bytes = make_zip_from_dir(SAMPLE_SHOP)
    response = client.post(
        "/projects/analyze-upload",
        files={"file": ("sample_shop.zip", zip_bytes, "application/zip")},
    )
    assert response.status_code == 422
