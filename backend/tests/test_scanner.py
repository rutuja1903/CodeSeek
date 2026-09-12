"""
test_scanner.py -- Tests for the repository scanner module.

These tests verify that:
  1. Python files in the root of the project are found.
  2. Python files in nested subdirectories are found.
  3. Non-Python files (README.md, config.json, etc.) are ignored.
  4. Returned paths are relative (not absolute).
  5. The ignored-dirs list works (e.g. __pycache__ is skipped).

We use the sample_shop project as our test fixture because it already
has the folder structure we need.
"""

import os
import sys

# Allow "import scanner" to work when tests are run from the project root.
# We add the services directory to sys.path so Python can find scanner.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app", "services"))

from scanner import scan_repository

# Compute the path to sample_shop relative to this test file.
# This avoids hard-coded absolute paths so the tests work on any machine.
THIS_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLE_SHOP = os.path.abspath(os.path.join(THIS_DIR, "..", "..", "sample_projects", "sample_shop"))


def test_root_python_files_are_found():
    """app.py, database.py, payment.py live directly in sample_shop/."""
    result = scan_repository(SAMPLE_SHOP)
    assert "app.py" in result, "Expected app.py to be found"
    assert "database.py" in result, "Expected database.py to be found"
    assert "payment.py" in result, "Expected payment.py to be found"


def test_nested_python_files_are_found():
    """Python files inside subdirectories must be discovered."""
    result = scan_repository(SAMPLE_SHOP)
    assert "services/auth.py" in result, "Expected services/auth.py to be found"
    assert "models/user.py" in result, "Expected models/user.py to be found"
    assert "utils/validation.py" in result, "Expected utils/validation.py to be found"


def test_non_python_files_are_ignored():
    """Files that are not .py must NOT appear in the results."""
    result = scan_repository(SAMPLE_SHOP)
    for path in result:
        assert path.endswith(".py"), (
            f"Non-Python file was returned by scanner: {path}"
        )


def test_returned_paths_are_relative():
    """
    No path in the result should be an absolute path.
    An absolute path would start with a drive letter (Windows) or '/' (Unix).
    """
    result = scan_repository(SAMPLE_SHOP)
    for path in result:
        assert not os.path.isabs(path), (
            f"Scanner returned an absolute path: {path}"
        )


def test_correct_total_count():
    """sample_shop has exactly 6 Python files as described in PROJECT_CONTEXT.md."""
    result = scan_repository(SAMPLE_SHOP)
    assert len(result) == 6, (
        f"Expected 6 Python files, but scanner found {len(result)}: {result}"
    )


def test_ignored_dirs_are_skipped():
    """
    __pycache__ folders (and other ignored dirs) must not contribute
    any files to the result.
    """
    result = scan_repository(SAMPLE_SHOP)
    for path in result:
        parts = path.split("/")
        for part in parts:
            assert part not in ("__pycache__", ".git", "venv", ".venv", "node_modules"), (
                f"Path from ignored directory appeared in results: {path}"
            )


if __name__ == "__main__":
    # Allow running directly: python test_scanner.py
    tests = [
        test_root_python_files_are_found,
        test_nested_python_files_are_found,
        test_non_python_files_are_ignored,
        test_returned_paths_are_relative,
        test_correct_total_count,
        test_ignored_dirs_are_skipped,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
