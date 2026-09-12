"""
test_search.py -- Tests for the CodeSeek search module.
"""

import os
import sys
import tempfile

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
# Add backend directory to path so 'app.services...' imports work
sys.path.insert(0, os.path.join(THIS_DIR, ".."))

from app.services.indexer import index_project
from app.services.search import search_project

SAMPLE_SHOP = os.path.abspath(
    os.path.join(THIS_DIR, "..", "..", "sample_projects", "sample_shop")
)

def setup_test_db():
    f = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_path = f.name
    f.close()
    project_id = index_project("sample_shop", SAMPLE_SHOP, db_path=db_path)
    return db_path, project_id

def teardown_test_db(db_path):
    if os.path.exists(db_path):
        os.remove(db_path)

def test_exact_symbol_name_ranks_highest():
    db_path, project_id = setup_test_db()
    try:
        # Search for "validate_email"
        results = search_project(project_id, "validate_email", db_path)
        assert len(results) > 0
        
        # The exact symbol match should be first
        first_result = results[0]
        assert first_result["type"] == "symbol"
        assert first_result["name"] == "validate_email"
        assert "exact symbol name match" in first_result["reasons"]
        
        # Another file or symbol might match it as a call, but exact name should win
        assert first_result["score"] >= 100
        
    finally:
        teardown_test_db(db_path)

def test_prefix_substring_and_parameter_search():
    db_path, project_id = setup_test_db()
    try:
        # "val" is a prefix for validate_amount and validate_email
        results = search_project(project_id, "val", db_path)
        assert len(results) > 0
        
        names = [r["name"] for r in results]
        assert "validate_email" in names
        assert "validate_amount" in names
        
        # Check prefix reason
        val_email = next(r for r in results if r["name"] == "validate_email")
        assert "prefix symbol name match" in val_email["reasons"]
        
        # Substring search: "amount"
        results_amt = search_project(project_id, "amount", db_path)
        names_amt = [r["name"] for r in results_amt]
        assert "validate_amount" in names_amt
        
        val_amt = next(r for r in results_amt if r["name"] == "validate_amount")
        assert "substring symbol name match" in val_amt["reasons"]
        assert "parameter match" in val_amt["reasons"] # amount is also a parameter
        assert val_amt["score"] >= (60 + 30) # Substring + Parameter
        
    finally:
        teardown_test_db(db_path)

def test_filename_path_search():
    db_path, project_id = setup_test_db()
    try:
        results = search_project(project_id, "auth", db_path)
        assert len(results) > 0
        
        auth_file = next((r for r in results if r["type"] == "file" and r["name"] == "services/auth.py"), None)
        assert auth_file is not None
        assert "filename/path match" in auth_file["reasons"]
        
    finally:
        teardown_test_db(db_path)

def test_docstring_search():
    db_path, project_id = setup_test_db()
    try:
        # "RFC 5322" is in the docstring of validate_email
        results = search_project(project_id, "rfc 5322", db_path)
        assert len(results) > 0
        
        first = results[0]
        assert first["name"] == "validate_email"
        assert "docstring match" in first["reasons"]
        assert first["score"] >= 20
        
    finally:
        teardown_test_db(db_path)

def test_call_and_import_search():
    db_path, project_id = setup_test_db()
    try:
        results = search_project(project_id, "AuthService", db_path)
        assert len(results) > 0
        
        # Exact match should be first
        assert results[0]["name"] == "AuthService"
        
        # Check that files calling/importing it are also returned
        app_file = next((r for r in results if r["type"] == "file" and r["name"] == "app.py"), None)
        assert app_file is not None
        assert "import/call match" in app_file["reasons"]
        
    finally:
        teardown_test_db(db_path)

def test_raw_source_search():
    db_path, project_id = setup_test_db()
    try:
        # Search for something that only appears in raw source
        results = search_project(project_id, "alice@example.com", db_path)
        assert len(results) > 0
        
        names = [r["name"] for r in results]
        assert "app.py" in names
        assert "database.py" in names
        
        app_res = next(r for r in results if r["name"] == "app.py")
        assert "raw source match" in app_res["reasons"]
        
    finally:
        teardown_test_db(db_path)

def test_strong_symbol_outranks_source_code():
    db_path, project_id = setup_test_db()
    try:
        # "process_payment" is a function in payment.py, and called in app.py
        results = search_project(project_id, "process_payment", db_path)
        assert len(results) > 0
        
        # The symbol 'process_payment' MUST rank higher than the file 'app.py' or 'payment.py'
        # just because they contain the string.
        assert results[0]["type"] == "symbol"
        assert results[0]["name"] == "process_payment"
        
    finally:
        teardown_test_db(db_path)

def test_case_insensitive_behavior():
    db_path, project_id = setup_test_db()
    try:
        results1 = search_project(project_id, "USER", db_path)
        results2 = search_project(project_id, "user", db_path)
        
        assert len(results1) == len(results2)
        assert results1[0]["id"] == results2[0]["id"]
        
    finally:
        teardown_test_db(db_path)

def test_empty_query_handling():
    db_path, project_id = setup_test_db()
    try:
        results = search_project(project_id, "", db_path)
        assert len(results) == 0
        
        results2 = search_project(project_id, "   ", db_path)
        assert len(results2) == 0
        
    finally:
        teardown_test_db(db_path)

def test_top_50_limit():
    db_path, project_id = setup_test_db()
    try:
        # A query like "e" will match almost everything
        results = search_project(project_id, "e", db_path, limit=2)
        assert len(results) == 2
        
    finally:
        teardown_test_db(db_path)

def test_deterministic_tie_breaking():
    db_path, project_id = setup_test_db()
    try:
        # Query that returns multiple items with identical scores
        res1 = search_project(project_id, "user", db_path)
        res2 = search_project(project_id, "user", db_path)
        res3 = search_project(project_id, "user", db_path)
        
        assert len(res1) > 1
        
        # Verify that ties exist in the result set
        scores = [r["score"] for r in res1]
        assert len(scores) != len(set(scores)), "Expected tie scores among search results"
        
        ids1 = [r["id"] for r in res1]
        ids2 = [r["id"] for r in res2]
        ids3 = [r["id"] for r in res3]
        
        assert ids1 == ids2 == ids3, "Repeated searches must return identical ordering for tie scores"
        
    finally:
        teardown_test_db(db_path)

if __name__ == "__main__":
    tests = [
        test_exact_symbol_name_ranks_highest,
        test_prefix_substring_and_parameter_search,
        test_filename_path_search,
        test_docstring_search,
        test_call_and_import_search,
        test_raw_source_search,
        test_strong_symbol_outranks_source_code,
        test_case_insensitive_behavior,
        test_empty_query_handling,
        test_top_50_limit,
        test_deterministic_tie_breaking
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

