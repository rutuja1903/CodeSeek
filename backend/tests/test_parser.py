"""
test_parser.py -- Tests for the AST parser module.

These tests use the sample_shop project as the main fixture because its
structure is documented in PROJECT_CONTEXT.md and we know exactly what
to expect from it.

Tests cover:
  - functions are detected
  - methods are detected
  - classes are detected
  - imports are detected
  - calls are detected
  - inheritance is detected
  - nested functions preserve parent context in symbol IDs
  - async functions are supported
  - syntax errors are handled without crashing the whole parser
  - symbol IDs are deterministic (same call always gives same ID)
"""

import os
import sys
import tempfile

# -------------------------------------------------------------------------
# Make sure Python can find parser.py when tests are run from any directory.
# -------------------------------------------------------------------------
THIS_DIR = os.path.dirname(os.path.abspath(__file__))
SERVICES_DIR = os.path.join(THIS_DIR, "..", "app", "services")
sys.path.insert(0, SERVICES_DIR)

from parser import parse_file, parse_repository

# -------------------------------------------------------------------------
# Paths to sample_shop files.
# -------------------------------------------------------------------------
SAMPLE_SHOP = os.path.abspath(
    os.path.join(THIS_DIR, "..", "..", "sample_projects", "sample_shop")
)

def _shop_file(rel):
    """Return the absolute path to a sample_shop file given its relative path."""
    return os.path.join(SAMPLE_SHOP, rel.replace("/", os.sep))


# =========================================================================
# Helper: collect symbols from a result by type
# =========================================================================

def _symbols_of_type(result, sym_type):
    """Return a list of symbols whose 'type' field equals sym_type."""
    return [s for s in result["symbols"] if s["type"] == sym_type]


def _symbol_names(result, sym_type):
    """Return just the names of symbols of the given type."""
    return [s["name"] for s in _symbols_of_type(result, sym_type)]


def _symbol_ids(result):
    """Return all symbol IDs in a result."""
    return [s["symbol_id"] for s in result["symbols"]]


# =========================================================================
# Test 1: standalone functions are detected
# =========================================================================

def test_standalone_functions_detected():
    """
    app.py has one standalone function: start_application().
    database.py has two: get_user() and save_payment().
    """
    app_result = parse_file(_shop_file("app.py"), root_dir=SAMPLE_SHOP)
    assert app_result["parse_ok"], "app.py should parse without error"

    func_names = _symbol_names(app_result, "function")
    assert "start_application" in func_names, (
        "Expected start_application in app.py functions; got: {}".format(func_names)
    )

    db_result = parse_file(_shop_file("database.py"), root_dir=SAMPLE_SHOP)
    assert db_result["parse_ok"]
    db_func_names = _symbol_names(db_result, "function")
    assert "get_user" in db_func_names, "Expected get_user in database.py"
    assert "save_payment" in db_func_names, "Expected save_payment in database.py"


# =========================================================================
# Test 2: methods are detected (FunctionDef inside ClassDef)
# =========================================================================

def test_methods_detected():
    """
    database.py: Database class has __init__, save, get methods.
    services/auth.py: AuthService class has login_user, display_name methods.
    """
    db_result = parse_file(_shop_file("database.py"), root_dir=SAMPLE_SHOP)
    method_names = _symbol_names(db_result, "method")
    assert "__init__" in method_names, "Expected __init__ method in Database"
    assert "save" in method_names, "Expected save method in Database"
    assert "get" in method_names, "Expected get method in Database"

    auth_result = parse_file(_shop_file("services/auth.py"), root_dir=SAMPLE_SHOP)
    auth_method_names = _symbol_names(auth_result, "method")
    assert "login_user" in auth_method_names, "Expected login_user method in AuthService"
    assert "display_name" in auth_method_names, "Expected display_name method in AuthService"


# =========================================================================
# Test 3: classes are detected
# =========================================================================

def test_classes_detected():
    """
    database.py: Database class.
    models/user.py: BaseUser and User classes.
    services/auth.py: AuthService class.
    """
    db_result = parse_file(_shop_file("database.py"), root_dir=SAMPLE_SHOP)
    class_names = _symbol_names(db_result, "class")
    assert "Database" in class_names, "Expected Database class in database.py"

    user_result = parse_file(_shop_file("models/user.py"), root_dir=SAMPLE_SHOP)
    user_class_names = _symbol_names(user_result, "class")
    assert "BaseUser" in user_class_names, "Expected BaseUser in models/user.py"
    assert "User" in user_class_names, "Expected User in models/user.py"

    auth_result = parse_file(_shop_file("services/auth.py"), root_dir=SAMPLE_SHOP)
    auth_class_names = _symbol_names(auth_result, "class")
    assert "AuthService" in auth_class_names, "Expected AuthService in services/auth.py"


# =========================================================================
# Test 4: imports are detected
# =========================================================================

def test_imports_detected():
    """
    app.py imports AuthService from services.auth and process_payment from payment.
    services/auth.py imports get_user from database and validate_email from utils.validation.
    """
    app_result = parse_file(_shop_file("app.py"), root_dir=SAMPLE_SHOP)
    assert app_result["parse_ok"]

    # Check that we have at least 2 imports in app.py
    assert len(app_result["imports"]) >= 2, (
        "Expected at least 2 imports in app.py; got: {}".format(app_result["imports"])
    )

    # Verify the from-imports
    imported_names = [imp["name"] for imp in app_result["imports"]]
    assert "AuthService" in imported_names, "Expected AuthService in app.py imports"
    assert "process_payment" in imported_names, "Expected process_payment in app.py imports"

    # Verify module sources for from-imports
    modules = [imp["module"] for imp in app_result["imports"] if imp["module"]]
    assert "services.auth" in modules, "Expected import from services.auth in app.py"
    assert "payment" in modules, "Expected import from payment in app.py"


def test_imports_detected_auth():
    """services/auth.py imports get_user and validate_email."""
    auth_result = parse_file(_shop_file("services/auth.py"), root_dir=SAMPLE_SHOP)
    imported_names = [imp["name"] for imp in auth_result["imports"]]
    assert "get_user" in imported_names, "Expected get_user import in auth.py"
    assert "validate_email" in imported_names, "Expected validate_email import in auth.py"


# =========================================================================
# Test 5: calls are detected
# =========================================================================

def test_calls_detected():
    """
    app.py calls AuthService(), auth.login_user(), and process_payment().
    services/auth.py calls validate_email() and get_user().
    """
    app_result = parse_file(_shop_file("app.py"), root_dir=SAMPLE_SHOP)
    call_names = [c["callee_name"] for c in app_result["calls"]]

    assert "AuthService" in call_names, (
        "Expected AuthService() call in app.py; got: {}".format(call_names)
    )
    assert "process_payment" in call_names, (
        "Expected process_payment() call in app.py; got: {}".format(call_names)
    )

    auth_result = parse_file(_shop_file("services/auth.py"), root_dir=SAMPLE_SHOP)
    auth_call_names = [c["callee_name"] for c in auth_result["calls"]]
    assert "validate_email" in auth_call_names, (
        "Expected validate_email call in auth.py; got: {}".format(auth_call_names)
    )
    assert "get_user" in auth_call_names, (
        "Expected get_user call in auth.py; got: {}".format(auth_call_names)
    )


# =========================================================================
# Test 6: inheritance is detected
# =========================================================================

def test_inheritance_detected():
    """
    models/user.py: User extends BaseUser.
    The User class symbol should have bases == ["BaseUser"].
    BaseUser has no declared base, so its bases list should be empty.
    """
    user_result = parse_file(_shop_file("models/user.py"), root_dir=SAMPLE_SHOP)

    # Find User and BaseUser in the symbols list.
    user_sym = None
    base_user_sym = None
    for sym in user_result["symbols"]:
        if sym["type"] == "class" and sym["name"] == "User":
            user_sym = sym
        if sym["type"] == "class" and sym["name"] == "BaseUser":
            base_user_sym = sym

    assert user_sym is not None, "Could not find User class in models/user.py"
    assert base_user_sym is not None, "Could not find BaseUser class in models/user.py"

    assert "BaseUser" in user_sym["bases"], (
        "Expected User to inherit from BaseUser; bases = {}".format(user_sym["bases"])
    )
    assert base_user_sym["bases"] == [], (
        "Expected BaseUser to have no bases; got: {}".format(base_user_sym["bases"])
    )


# =========================================================================
# Test 7: nested functions preserve parent context in symbol IDs
# =========================================================================

def test_nested_functions_have_parent_context():
    """
    When a function is defined inside another function, its symbol_id must
    include the parent function's name so the ID is unique and traceable.

    We create a temporary file with a nested function to test this directly.
    """
    source = """\
def outer():
    def inner():
        pass
"""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w",
                                     delete=False, encoding="utf-8") as f:
        f.write(source)
        tmp_path = f.name

    try:
        result = parse_file(tmp_path)
        assert result["parse_ok"], "Temporary file should parse cleanly"

        ids = _symbol_ids(result)
        # The nested function's ID must contain both "outer" and "inner".
        nested_ids = [sid for sid in ids if "inner" in sid]
        assert nested_ids, "Expected to find 'inner' in symbol IDs; got: {}".format(ids)

        nested_id = nested_ids[0]
        assert "outer" in nested_id, (
            "Nested function ID should contain parent name 'outer'; got: {}".format(nested_id)
        )
        assert "inner" in nested_id, (
            "Nested function ID should contain 'inner'; got: {}".format(nested_id)
        )
        # The nested function type should be "nested_function".
        nested_syms = [s for s in result["symbols"] if s["name"] == "inner"]
        assert nested_syms, "Expected a symbol named 'inner'"
        assert nested_syms[0]["type"] == "nested_function", (
            "Expected type 'nested_function'; got '{}'".format(nested_syms[0]["type"])
        )
    finally:
        os.unlink(tmp_path)


def test_nested_function_parent_id():
    """
    The parent_id of a nested function must be the symbol_id of the
    outer function (not None and not a class ID).
    """
    source = """\
def outer():
    def inner():
        pass
"""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w",
                                     delete=False, encoding="utf-8") as f:
        f.write(source)
        tmp_path = f.name

    try:
        result = parse_file(tmp_path)
        outer_syms = [s for s in result["symbols"] if s["name"] == "outer"]
        inner_syms = [s for s in result["symbols"] if s["name"] == "inner"]

        assert outer_syms and inner_syms

        outer_id = outer_syms[0]["symbol_id"]
        inner_parent = inner_syms[0]["parent_id"]

        assert inner_parent == outer_id, (
            "inner's parent_id ({}) should equal outer's symbol_id ({})".format(
                inner_parent, outer_id
            )
        )
    finally:
        os.unlink(tmp_path)


# =========================================================================
# Test 8: async functions are supported
# =========================================================================

def test_async_functions_supported():
    """
    An 'async def' at module level should have type 'async_function'.
    An 'async def' inside a class should have type 'async_method'.
    """
    source = """\
async def fetch_data(url):
    pass

class Service:
    async def handle(self, request):
        pass
"""
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w",
                                     delete=False, encoding="utf-8") as f:
        f.write(source)
        tmp_path = f.name

    try:
        result = parse_file(tmp_path)
        assert result["parse_ok"], "Async test file should parse cleanly"

        async_funcs = _symbols_of_type(result, "async_function")
        async_methods = _symbols_of_type(result, "async_method")

        assert any(s["name"] == "fetch_data" for s in async_funcs), (
            "Expected fetch_data as async_function; symbols: {}".format(result["symbols"])
        )
        assert any(s["name"] == "handle" for s in async_methods), (
            "Expected handle as async_method; symbols: {}".format(result["symbols"])
        )
    finally:
        os.unlink(tmp_path)


# =========================================================================
# Test 9: syntax errors are handled without crashing
# =========================================================================

def test_syntax_error_does_not_crash():
    """
    A file with bad Python syntax must NOT raise an exception.
    Instead parse_file() must return parse_ok=False and an error message.
    """
    bad_source = "def broken(\n    # missing closing paren and body\n"
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w",
                                     delete=False, encoding="utf-8") as f:
        f.write(bad_source)
        tmp_path = f.name

    try:
        # This must not raise.
        result = parse_file(tmp_path)

        assert result["parse_ok"] is False, (
            "Expected parse_ok=False for a broken file; got True"
        )
        assert result["error"] is not None, "Expected an error message for a broken file"
        assert len(result["error"]) > 0, "Error message should not be empty"

        # All lists should be empty when parsing fails.
        assert result["symbols"] == [], "symbols should be empty on parse failure"
        assert result["imports"] == [], "imports should be empty on parse failure"
        assert result["calls"] == [], "calls should be empty on parse failure"
    finally:
        os.unlink(tmp_path)


def test_syntax_error_does_not_stop_other_files():
    """
    When parse_repository() processes a mix of good and bad files,
    the bad file must NOT prevent good files from being parsed.
    """
    # Create a temporary directory with one good file and one broken file.
    with tempfile.TemporaryDirectory() as tmp_dir:
        good_path = os.path.join(tmp_dir, "good.py")
        bad_path = os.path.join(tmp_dir, "bad.py")

        with open(good_path, "w", encoding="utf-8") as f:
            f.write("def hello(): pass\n")

        with open(bad_path, "w", encoding="utf-8") as f:
            f.write("def broken(\n")

        # Use parse_repository with relative paths.
        results = parse_repository(tmp_dir, ["good.py", "bad.py"])

        assert len(results) == 2, "Expected one result per file"

        good_result = next(r for r in results if "good" in r["file_path"])
        bad_result = next(r for r in results if "bad" in r["file_path"])

        assert good_result["parse_ok"] is True, "good.py should parse successfully"
        assert bad_result["parse_ok"] is False, "bad.py should fail with parse_ok=False"

        # The good file should have its function extracted.
        func_names = [s["name"] for s in good_result["symbols"]]
        assert "hello" in func_names, "hello function should be found in good.py"


# =========================================================================
# Test 10: symbol IDs are deterministic
# =========================================================================

def test_symbol_ids_are_deterministic():
    """
    Calling parse_file() twice on the same file must produce identical
    symbol IDs. This ensures that re-indexing produces consistent IDs.
    """
    result1 = parse_file(_shop_file("models/user.py"), root_dir=SAMPLE_SHOP)
    result2 = parse_file(_shop_file("models/user.py"), root_dir=SAMPLE_SHOP)

    ids1 = sorted([s["symbol_id"] for s in result1["symbols"]])
    ids2 = sorted([s["symbol_id"] for s in result2["symbols"]])

    assert ids1 == ids2, (
        "Symbol IDs changed between two parses of the same file: {} vs {}".format(ids1, ids2)
    )


def test_symbol_id_format():
    """
    Symbol IDs must follow the format:
        relative/path.py::SymbolName
    or  relative/path.py::ClassName.method_name

    Verify the IDs for known symbols in the sample_shop.
    """
    user_result = parse_file(_shop_file("models/user.py"), root_dir=SAMPLE_SHOP)
    ids = _symbol_ids(user_result)

    assert "models/user.py::BaseUser" in ids, (
        "Expected 'models/user.py::BaseUser' in IDs; got: {}".format(ids)
    )
    assert "models/user.py::User" in ids, (
        "Expected 'models/user.py::User' in IDs; got: {}".format(ids)
    )
    assert "models/user.py::User.display_name" in ids, (
        "Expected 'models/user.py::User.display_name' in IDs; got: {}".format(ids)
    )
    assert "models/user.py::BaseUser.display_name" in ids, (
        "Expected 'models/user.py::BaseUser.display_name' in IDs; got: {}".format(ids)
    )


# =========================================================================
# Test 11: method's parent_id points to its class
# =========================================================================

def test_method_parent_id_is_class():
    """
    Each method in AuthService must have parent_id pointing to the
    AuthService class symbol, not None or another method.
    """
    auth_result = parse_file(_shop_file("services/auth.py"), root_dir=SAMPLE_SHOP)

    class_sym = next(
        (s for s in auth_result["symbols"] if s["name"] == "AuthService"),
        None
    )
    assert class_sym is not None, "AuthService class not found"

    class_id = class_sym["symbol_id"]

    methods = _symbols_of_type(auth_result, "method")
    assert methods, "Expected methods in auth.py"

    for method in methods:
        assert method["parent_id"] == class_id, (
            "Method '{}' parent_id ({}) should be the AuthService class ID ({})".format(
                method["name"], method["parent_id"], class_id
            )
        )


# =========================================================================
# Test 12: parameters are extracted
# =========================================================================

def test_parameters_extracted():
    """
    Functions should have their parameter names recorded.
    """
    app_result = parse_file(_shop_file("app.py"), root_dir=SAMPLE_SHOP)
    start_sym = next(
        (s for s in app_result["symbols"] if s["name"] == "start_application"),
        None
    )
    assert start_sym is not None, "start_application not found"
    assert "username" in start_sym["parameters"], (
        "Expected 'username' in start_application params; got: {}".format(
            start_sym["parameters"]
        )
    )
    assert "password" in start_sym["parameters"]
    assert "amount" in start_sym["parameters"]


# =========================================================================
# Test 13: docstrings are extracted
# =========================================================================

def test_docstrings_extracted():
    """
    Functions and classes with docstrings should have them captured.
    """
    db_result = parse_file(_shop_file("database.py"), root_dir=SAMPLE_SHOP)

    db_class = next(
        (s for s in db_result["symbols"] if s["name"] == "Database"), None
    )
    assert db_class is not None
    assert db_class["docstring"] is not None, "Database class should have a docstring"
    assert len(db_class["docstring"]) > 0

    get_user_sym = next(
        (s for s in db_result["symbols"] if s["name"] == "get_user"), None
    )
    assert get_user_sym is not None
    assert get_user_sym["docstring"] is not None, "get_user should have a docstring"


# =========================================================================
# Test 14: line numbers are captured
# =========================================================================

def test_line_numbers_captured():
    """
    Every symbol must have a start_line >= 1.
    end_line (when available) must be >= start_line.
    """
    for rel_path in ["app.py", "database.py", "models/user.py",
                     "services/auth.py", "utils/validation.py", "payment.py"]:
        result = parse_file(_shop_file(rel_path), root_dir=SAMPLE_SHOP)
        assert result["parse_ok"], "{} should parse cleanly".format(rel_path)

        for sym in result["symbols"]:
            assert sym["start_line"] >= 1, (
                "{}: symbol '{}' has bad start_line {}".format(
                    rel_path, sym["name"], sym["start_line"]
                )
            )
            if sym["end_line"] is not None:
                assert sym["end_line"] >= sym["start_line"], (
                    "{}: symbol '{}' end_line {} < start_line {}".format(
                        rel_path, sym["name"], sym["end_line"], sym["start_line"]
                    )
                )


# =========================================================================
# Test 15: parse_repository processes all sample_shop files
# =========================================================================

def test_parse_repository_processes_all_files():
    """
    parse_repository() on sample_shop should return 6 result dicts,
    all with parse_ok=True.
    """
    # Use the same file list the scanner would produce.
    python_files = [
        "app.py",
        "database.py",
        "models/user.py",
        "payment.py",
        "services/auth.py",
        "utils/validation.py",
    ]
    results = parse_repository(SAMPLE_SHOP, python_files)

    assert len(results) == 6, (
        "Expected 6 results from parse_repository; got {}".format(len(results))
    )

    for r in results:
        assert r["parse_ok"], (
            "File '{}' failed to parse: {}".format(r["file_path"], r["error"])
        )


# =========================================================================
# Manual runner (python test_parser.py)
# =========================================================================

if __name__ == "__main__":
    tests = [
        test_standalone_functions_detected,
        test_methods_detected,
        test_classes_detected,
        test_imports_detected,
        test_imports_detected_auth,
        test_calls_detected,
        test_inheritance_detected,
        test_nested_functions_have_parent_context,
        test_nested_function_parent_id,
        test_async_functions_supported,
        test_syntax_error_does_not_crash,
        test_syntax_error_does_not_stop_other_files,
        test_symbol_ids_are_deterministic,
        test_symbol_id_format,
        test_method_parent_id_is_class,
        test_parameters_extracted,
        test_docstrings_extracted,
        test_line_numbers_captured,
        test_parse_repository_processes_all_files,
    ]

    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print("  PASS  {}".format(t.__name__))
            passed += 1
        except AssertionError as exc:
            print("  FAIL  {}: {}".format(t.__name__, exc))
            failed += 1
        except Exception as exc:
            print("  ERROR {}: {}".format(t.__name__, exc))
            failed += 1

    print("\n{} passed, {} failed".format(passed, failed))
