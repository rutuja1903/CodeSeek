"""
scanner.py -- Repository Scanner Module

This module takes a local project directory path and recursively finds
all Python (.py) files inside it. It returns their paths relative to
the root of the project (not absolute paths), so the index stays
portable across machines.

Non-Python files are ignored. Common generated/tooling folders like
.git, __pycache__, and virtual environments are also skipped so we
do not waste time scanning them.
"""

import os

# Folders that should never be scanned.
# These are generated or tool-specific directories that contain no
# meaningful project source code.
IGNORED_DIRS = {
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    "node_modules",
    ".mypy_cache",
    ".pytest_cache",
    "dist",
    "build",
    ".eggs",
}


def scan_repository(root_dir: str) -> list:
    """
    Recursively scan a directory and return a list of relative paths
    to all Python (.py) files found inside it.

    Parameters
    ----------
    root_dir : str
        The absolute (or relative) path to the project root directory
        that you want to scan.

    Returns
    -------
    list
        A sorted list of file paths relative to root_dir, using forward
        slashes as separators. For example:
            ["app.py", "models/user.py", "services/auth.py"]

    Notes
    -----
    - Only files ending in ".py" are returned.
    - The function never executes any of the scanned files.
    - Folders listed in IGNORED_DIRS are skipped entirely.
    """

    # Normalise the root path so comparisons are consistent.
    root_dir = os.path.abspath(root_dir)

    python_files = []

    # os.walk yields (current_folder, list_of_subfolders, list_of_files)
    # for every directory in the tree, starting from root_dir.
    for current_dir, subdirs, files in os.walk(root_dir):

        # Modify subdirs *in place* to tell os.walk which sub-folders
        # to descend into. Removing a name here prevents os.walk from
        # ever visiting that folder or anything below it.
        subdirs[:] = [
            d for d in subdirs
            if d not in IGNORED_DIRS
        ]

        for filename in files:
            # We only care about Python source files.
            if not filename.endswith(".py"):
                continue

            # Build the full absolute path to this file.
            abs_path = os.path.join(current_dir, filename)

            # Convert to a path relative to the project root.
            # os.path.relpath gives us the relative path using the
            # OS-native separator (backslash on Windows).
            rel_path = os.path.relpath(abs_path, root_dir)

            # Normalise separators to forward slashes so the paths
            # look consistent regardless of which OS is running CodeSeek.
            rel_path = rel_path.replace(os.sep, "/")

            python_files.append(rel_path)

    # Sort so the output is deterministic -- same directory always
    # produces the same list in the same order.
    python_files.sort()

    return python_files
