"""
test_graphs.py -- Tests for CodeSeek dependency analysis and graphs.
"""
import os
import sys
import tempfile

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(THIS_DIR, ".."))

from app.database.core import init_db
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

def test_cycles():
    from app.database.core import get_connection
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_path = f.name
    f.close()
    try:
        init_db(db_path)
        conn = get_connection(db_path)
        c = conn.cursor()
        
        c.execute("INSERT INTO projects (name, root_path) VALUES (?, ?)", ("cycle_test", "/tmp/cycle_test"))
        pid = c.lastrowid
        
        c.execute("INSERT INTO files (project_id, relative_path, language, line_count, parse_status) VALUES (?, ?, ?, ?, ?)", (pid, "a.py", "python", 10, 1))
        fa = c.lastrowid
        c.execute("INSERT INTO files (project_id, relative_path, language, line_count, parse_status) VALUES (?, ?, ?, ?, ?)", (pid, "b.py", "python", 10, 1))
        fb = c.lastrowid
        c.execute("INSERT INTO files (project_id, relative_path, language, line_count, parse_status) VALUES (?, ?, ?, ?, ?)", (pid, "c.py", "python", 10, 1))
        fc = c.lastrowid
        
        # 1. file circular dependency: a.py -> b.py -> a.py
        c.execute("INSERT INTO imports (project_id, file_id, module) VALUES (?, ?, ?)", (pid, fa, "b"))
        c.execute("INSERT INTO imports (project_id, file_id, module) VALUES (?, ?, ?)", (pid, fb, "a"))
        
        # 2. symbols
        c.execute("INSERT INTO symbols (project_id, file_id, deterministic_id, name, symbol_type) VALUES (?, ?, ?, ?, ?)", (pid, fa, "a.py::A", "A", "function"))
        c.execute("INSERT INTO symbols (project_id, file_id, deterministic_id, name, symbol_type) VALUES (?, ?, ?, ?, ?)", (pid, fb, "b.py::B", "B", "function"))
        c.execute("INSERT INTO symbols (project_id, file_id, deterministic_id, name, symbol_type) VALUES (?, ?, ?, ?, ?)", (pid, fc, "c.py::C", "C", "function"))
        
        # function self-recursion: A -> A
        c.execute("INSERT INTO calls (project_id, caller_symbol_id, raw_callee_name) VALUES (?, ?, ?)", (pid, "a.py::A", "A"))
        
        # two-function cycle: B -> A, A -> B
        c.execute("INSERT INTO calls (project_id, caller_symbol_id, raw_callee_name) VALUES (?, ?, ?)", (pid, "b.py::B", "A"))
        c.execute("INSERT INTO calls (project_id, caller_symbol_id, raw_callee_name) VALUES (?, ?, ?)", (pid, "a.py::A", "B"))
        
        # longer function cycle: A -> B -> C -> A
        c.execute("INSERT INTO calls (project_id, caller_symbol_id, raw_callee_name) VALUES (?, ?, ?)", (pid, "b.py::B", "C"))
        c.execute("INSERT INTO calls (project_id, caller_symbol_id, raw_callee_name) VALUES (?, ?, ?)", (pid, "c.py::C", "A"))
        
        # unresolved-call
        c.execute("INSERT INTO calls (project_id, caller_symbol_id, raw_callee_name) VALUES (?, ?, ?)", (pid, "c.py::C", "unknown_func"))
        
        conn.commit()
        conn.close()
        
        # Test file graph
        G, unres = build_file_dependency_graph(pid, db_path)
        data = graph_to_json(G, unres)
        
        assert data["cycle_count"] == 1
        assert len(data["cycles"][0]) == 2
        assert "a.py" in data["cycles"][0] and "b.py" in data["cycles"][0]
        
        # Test call graph
        G2, unres2 = build_call_graph(pid, db_path)
        data2 = graph_to_json(G2, unres2)
        
        # Expect self-recursion: A->A
        assert data2["self_loop_count"] == 1
        assert data2["self_loops"][0] == ["a.py::A"]
        
        # Unresolved behavior untouched
        unres_reasons = [u["callee_raw"] for u in data2["unresolved"]]
        assert "unknown_func" in unres_reasons
        
        assert data2["cycle_count"] == 2
        lengths = [len(c) for c in data2["cycles"]]
        assert sorted(lengths) == [2, 3]

    finally:
        if os.path.exists(db_path):
            os.remove(db_path)

if __name__ == "__main__":
    tests = [
        test_file_dependency_graph,
        test_call_graph,
        test_cycles
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
