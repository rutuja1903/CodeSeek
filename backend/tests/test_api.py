"""
test_api.py -- Tests for CodeSeek FastAPI layer.
"""
import os
import sys
import tempfile
import sqlite3
from fastapi.testclient import TestClient

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(THIS_DIR, ".."))

from app.main import app

client = TestClient(app)

SAMPLE_SHOP = os.path.abspath(
    os.path.join(THIS_DIR, "..", "..", "sample_projects", "sample_shop")
)
TEST_DB_PATH = os.path.join(THIS_DIR, "..", "codeseek.db")

def test_app_starts():
    response = client.get("/docs")
    assert response.status_code == 200

def test_analyze_project():
    if os.path.exists(TEST_DB_PATH):
        os.remove(TEST_DB_PATH)
        
    payload = {
        "name": "sample_shop",
        "directory_path": SAMPLE_SHOP
    }
    response = client.post("/projects/analyze", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Project indexed successfully"
    assert "project_id" in data

def test_analyze_invalid_dir():
    payload = {
        "name": "invalid",
        "directory_path": "/path/does/not/exist/12345"
    }
    response = client.post("/projects/analyze", json=payload)
    assert response.status_code == 400

def test_project_overview():
    # Assume project_id = 1 from previous test
    response = client.get("/projects/1")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "sample_shop"
    assert data["counts"]["files"] == 6

def test_project_not_found():
    response = client.get("/projects/999")
    assert response.status_code == 404

def test_files_endpoint():
    response = client.get("/projects/1/files")
    assert response.status_code == 200
    files = response.json()
    assert len(files) == 6

def test_symbols_endpoint():
    response = client.get("/projects/1/symbols")
    assert response.status_code == 200
    symbols = response.json()
    assert len(symbols) > 0
    
    # Test filtering
    res_filtered = client.get("/projects/1/symbols?type=class")
    assert res_filtered.status_code == 200
    classes = res_filtered.json()
    assert all(s["symbol_type"] == "class" for s in classes)
    assert len(classes) < len(symbols)

def test_search_endpoint():
    response = client.get("/projects/1/search?q=validate_email")
    assert response.status_code == 200
    results = response.json()
    assert len(results) > 0
    assert results[0]["name"] == "validate_email"

def test_empty_search():
    # FastAPI Query(..., min_length=1) will reject this with 422
    response = client.get("/projects/1/search?q=")
    assert response.status_code == 422

def test_individual_symbol():
    # Using path parameter that contains slashes
    symbol_id = "models/user.py::User"
    response = client.get(f"/symbols/{symbol_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "User"
    assert data["symbol_type"] == "class"
    assert "BaseUser" in data["bases"]

def test_invalid_symbol():
    response = client.get("/symbols/invalid::symbol")
    assert response.status_code == 404

def test_file_dependency_graph():
    response = client.get("/projects/1/dependencies/files")
    assert response.status_code == 200
    data = response.json()
    assert "nodes" in data
    assert "edges" in data
    assert len(data["nodes"]) == 6

def test_function_call_graph():
    response = client.get("/projects/1/dependencies/functions")
    assert response.status_code == 200
    data = response.json()
    assert "nodes" in data
    assert "edges" in data
    assert len(data["nodes"]) > 0

def test_statistics_endpoint():
    response = client.get("/projects/1/stats")
    assert response.status_code == 200
    data = response.json()
    assert "file_dependencies" in data
    assert "function_calls" in data
    assert data["file_dependencies"]["node_count"] == 6
