"""
test_indexer.py -- Tests for the SQLite storage and indexer pipeline.
"""

import os
import sys
import tempfile
import sqlite3

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
# Add backend directory to path so 'app.services...' imports work
sys.path.insert(0, os.path.join(THIS_DIR, ".."))

from app.services.indexer import index_project

SAMPLE_SHOP = os.path.abspath(
    os.path.join(THIS_DIR, "..", "..", "sample_projects", "sample_shop")
)

def test_index_project_and_counts():
    """
    Test that indexing the sample_shop project stores the correct counts
    for files, symbols, imports, and calls.
    """
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    
    try:
        # Index the project
        project_id = index_project("sample_shop", SAMPLE_SHOP, db_path=db_path)
        
        # Connect to DB to verify
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Verify projects table
        cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        project = cursor.fetchone()
        assert project is not None
        assert project["name"] == "sample_shop"
        assert project["root_path"] == SAMPLE_SHOP
        
        # Verify 6 files are stored
        cursor.execute("SELECT count(*) as cnt FROM files WHERE project_id = ?", (project_id,))
        file_count = cursor.fetchone()["cnt"]
        assert file_count == 6
        
        # Check files paths are relative
        cursor.execute("SELECT relative_path FROM files WHERE project_id = ?", (project_id,))
        paths = [row["relative_path"] for row in cursor.fetchall()]
        assert "app.py" in paths
        assert "models/user.py" in paths
        for path in paths:
            assert not os.path.isabs(path), f"Path should be relative, got: {path}"
        
        # Verify symbols are stored and functions/methods distinguishable
        cursor.execute("SELECT count(*) as cnt FROM symbols WHERE project_id = ?", (project_id,))
        symbol_count = cursor.fetchone()["cnt"]
        assert symbol_count > 0, "Symbols should be indexed"
        
        # Verify functions and methods
        cursor.execute("SELECT symbol_type, count(*) as cnt FROM symbols GROUP BY symbol_type")
        type_counts = {row["symbol_type"]: row["cnt"] for row in cursor.fetchall()}
        assert "function" in type_counts
        assert "method" in type_counts
        assert "class" in type_counts
        
        # Check specific symbol: User class
        cursor.execute("SELECT * FROM symbols WHERE name = 'User' AND symbol_type = 'class'")
        user_class = cursor.fetchone()
        assert user_class is not None
        assert "BaseUser" in user_class["bases"], "Inheritance metadata should be stored"
        assert user_class["deterministic_id"].endswith("models/user.py::User")
        
        # Check imports are stored
        cursor.execute("SELECT count(*) as cnt FROM imports WHERE project_id = ?", (project_id,))
        import_count = cursor.fetchone()["cnt"]
        assert import_count > 0, "Imports should be indexed"
        
        # Check calls are stored
        cursor.execute("SELECT count(*) as cnt FROM calls WHERE project_id = ?", (project_id,))
        call_count = cursor.fetchone()["cnt"]
        assert call_count > 0, "Calls should be indexed"
        
        # Print counts
        print(f"\n[sample_shop indexed counts]")
        print(f"Files: {file_count}")
        print(f"Symbols: {symbol_count}")
        print(f"Imports: {import_count}")
        print(f"Calls: {call_count}")
        
    finally:
        conn.close()
        os.remove(db_path)

def test_reindexing_behavior():
    """
    Test that indexing the same project twice does not duplicate data.
    """
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    
    try:
        # Index once
        index_project("sample_shop", SAMPLE_SHOP, db_path=db_path)
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        cursor.execute("SELECT count(*) FROM symbols")
        count_first = cursor.fetchone()[0]
        
        # Index again
        index_project("sample_shop", SAMPLE_SHOP, db_path=db_path)
        
        cursor.execute("SELECT count(*) FROM symbols")
        count_second = cursor.fetchone()[0]
        
        # Count should be exactly the same, no duplicates
        assert count_first == count_second, "Re-indexing duplicated data!"
        
        cursor.execute("SELECT count(*) FROM projects WHERE name = 'sample_shop'")
        assert cursor.fetchone()[0] == 1, "Should only have 1 project record"
        
    finally:
        conn.close()
        os.remove(db_path)

def test_parse_failure_behavior():
    """
    Test that a parse failure is stored but does not crash the indexing.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create a valid file and a broken file
        with open(os.path.join(tmp_dir, "good.py"), "w", encoding="utf-8") as f:
            f.write("def hello(): pass\n")
        
        with open(os.path.join(tmp_dir, "bad.py"), "w", encoding="utf-8") as f:
            f.write("def broken(\n")
        
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as db_f:
            db_path = db_f.name
        
        try:
            index_project("broken_project", tmp_dir, db_path=db_path)
            
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # 2 files should be stored
            cursor.execute("SELECT * FROM files ORDER BY relative_path")
            files = cursor.fetchall()
            assert len(files) == 2
            
            bad_file, good_file = files[0], files[1]
            assert bad_file["relative_path"] == "bad.py"
            assert good_file["relative_path"] == "good.py"
            
            assert bad_file["parse_status"] == 0 # False
            assert "SyntaxError" in bad_file["parse_error"]
            
            assert good_file["parse_status"] == 1 # True
            assert good_file["parse_error"] is None
            
        finally:
            conn.close()
            os.remove(db_path)

if __name__ == "__main__":
    tests = [
        test_index_project_and_counts,
        test_reindexing_behavior,
        test_parse_failure_behavior
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
