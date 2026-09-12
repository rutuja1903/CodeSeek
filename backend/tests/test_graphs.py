"""
test_graphs.py -- Tests for CodeSeek dependency analysis and graphs.
"""
import os
import sys
import tempfile

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(THIS_DIR, ".."))

from app.services.indexer import index_project
from app.services.graphs import build_file_dependency_graph, build_call_graph, graph_to_json, calculate_graph_metrics

SAMPLE_SHOP = os.path.abspath(
    os.path.join(THIS_DIR, "..", "..", "sample_projects", "sample_shop")
)

def test_file_dependency_graph():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_path = f.name
    f.close()
    try:
        project_id = index_project("sample_shop", SAMPLE_SHOP, db_path=db_path)
        G, unresolved = build_file_dependency_graph(project_id, db_path)
        
        # 1. Check nodes
        nodes = list(G.nodes)
        assert len(nodes) == 6
        assert "app.py" in nodes
        assert "services/auth.py" in nodes
        
        # 2. Check edges (internal imports)
        edges = list(G.edges)
        assert ("app.py", "services/auth.py") in edges
        assert ("app.py", "payment.py") in edges
        
        # 3. Check unresolved (external)
        # For sample_shop, there are exactly 6 imports and all are internal.
        assert len(unresolved) == 0
        
        # 4. JSON friendly
        data = graph_to_json(G, unresolved)
        assert "nodes" in data and "edges" in data and "unresolved" in data
        assert len(data["nodes"]) == 6
        
        # 5. Metrics
        metrics = calculate_graph_metrics(G)
        assert metrics["node_count"] == 6
        assert metrics["edge_count"] > 0
        
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

def test_call_graph():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_path = f.name
    f.close()
    try:
        project_id = index_project("sample_shop", SAMPLE_SHOP, db_path=db_path)
        G, unresolved = build_call_graph(project_id, db_path)
        
        # 1. Deterministic node IDs
        assert "app.py::start_application" in G.nodes
        assert "utils/validation.py::validate_email" in G.nodes
        
        # 2. Direct simple calls resolved
        edges = list(G.edges)
        # AuthService.login_user calls validate_email
        assert ("services/auth.py::AuthService.login_user", "utils/validation.py::validate_email") in edges
        
        # 3. Unambiguous method calls
        assert ("app.py::start_application", "services/auth.py::AuthService.login_user") in edges
        
        # 4. Ambiguous or external calls unresolved
        unres_reasons = [u["reason"] for u in unresolved]
        assert "ambiguous" in unres_reasons or "not found" in unres_reasons
        
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

if __name__ == "__main__":
    tests = [
        test_file_dependency_graph,
        test_call_graph
    ]
    
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as exc:
            print(f"  FAIL  {t.__name__}: {exc}")
            failed += 1
        except Exception as exc:
            print(f"  ERROR {t.__name__}: {exc}")
            failed += 1

    print(f"\n{passed} passed, {failed} failed")
