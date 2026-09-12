"""
parser.py -- AST Parser Module

This module reads a Python source file and extracts structural metadata
from it using Python's built-in 'ast' module.

It extracts:
  - functions  (FunctionDef / AsyncFunctionDef at module level)
  - methods    (FunctionDef / AsyncFunctionDef inside a ClassDef)
  - nested functions (FunctionDef inside another FunctionDef)
  - classes    (ClassDef), including base-class (inheritance) info
  - imports    (Import and ImportFrom)
  - calls      (Call nodes), captured as raw callee names

The parser never executes the file -- it only reads and analyses the
source text statically.

Returned data shapes
--------------------
parse_file() returns a dict with these keys:

  file_path   : str   -- relative path that was passed in
  line_count  : int   -- total number of lines in the file
  source_code : str   -- raw source text
  parse_ok    : bool  -- True if parsing succeeded, False on SyntaxError
  error       : str | None -- error message when parse_ok is False

  symbols     : list[dict]  -- functions, methods, classes
  imports     : list[dict]  -- import statements
  calls       : list[dict]  -- function/method calls detected

Symbol dict keys
----------------
  symbol_id   : str  -- deterministic ID, e.g. "models/user.py::User.display_name"
  name        : str
  type        : str  -- "function", "async_function", "method",
                        "async_method", "nested_function", "class"
  file_path   : str
  start_line  : int
  end_line    : int | None
  parent_id   : str | None -- symbol_id of the enclosing class or function
  parameters  : list[str]  -- parameter names
  docstring   : str | None
  bases       : list[str]  -- base class names (classes only)

Import dict keys
----------------
  module      : str | None  -- module being imported from (ImportFrom) or None
  name        : str         -- name being imported or the module (Import)
  alias       : str | None  -- 'as' alias if present
  line_number : int

Call dict keys
--------------
  callee_name    : str   -- raw call name extracted from the AST
  caller_id      : str | None -- symbol_id of the enclosing function/method
  line_number    : int
"""

import ast
import os


# ---------------------------------------------------------------------------
# Helper: build a deterministic symbol ID
# ---------------------------------------------------------------------------

def _make_symbol_id(file_path, *name_parts):
    """
    Build a unique, deterministic identifier for a symbol.

    Format: "relative/path.py::outer_name.inner_name"

    Examples:
        _make_symbol_id("app.py", "start_application")
            -> "app.py::start_application"
        _make_symbol_id("models/user.py", "User", "display_name")
            -> "models/user.py::User.display_name"
        _make_symbol_id("services/auth.py", "AuthService", "login_user", "_helper")
            -> "services/auth.py::AuthService.login_user._helper"

    We always use forward slashes in the path part so IDs are consistent
    across Windows and Unix.
    """
    normalised_path = file_path.replace(os.sep, "/")
    qualified_name = ".".join(name_parts)
    return "{}::{}".format(normalised_path, qualified_name)


# ---------------------------------------------------------------------------
# Helper: extract the callee name from a Call node
# ---------------------------------------------------------------------------

def _get_callee_name(call_node):
    """
    Try to get a human-readable name for what is being called.

    For simple calls like  foo()          -> "foo"
    For attribute calls like obj.method() -> "obj.method"
    For chained calls like a.b.c()        -> "a.b.c"

    Returns None for things we cannot easily name (e.g. lambda calls).
    We do NOT try to resolve what object 'obj' is -- that requires
    runtime type information we do not have.
    """
    func = call_node.func

    if isinstance(func, ast.Name):
        # Simple call: foo()
        return func.id

    if isinstance(func, ast.Attribute):
        # Attribute call: obj.method() or a.b.c()
        # Walk the chain to build a dotted name.
        parts = []
        node = func
        while isinstance(node, ast.Attribute):
            parts.append(node.attr)
            node = node.value
        if isinstance(node, ast.Name):
            parts.append(node.id)
        parts.reverse()
        return ".".join(parts)

    # For anything else (subscripts, starred expressions, etc.) give up.
    return None


# ---------------------------------------------------------------------------
# Helper: extract parameter names from an arguments node
# ---------------------------------------------------------------------------

def _get_param_names(args_node):
    """
    Return the list of parameter names from a function's argument list.

    Includes: positional args, *args, keyword-only args, **kwargs.
    We keep 'self' and 'cls' in the list since they are valid parameters.
    """
    params = []

    # Regular positional (and positional-or-keyword) arguments.
    for arg in args_node.args:
        params.append(arg.arg)

    # The *args parameter, if present.
    if args_node.vararg:
        params.append("*{}".format(args_node.vararg.arg))

    # Keyword-only arguments (those after *args or a bare *).
    for arg in args_node.kwonlyargs:
        params.append(arg.arg)

    # The **kwargs parameter, if present.
    if args_node.kwarg:
        params.append("**{}".format(args_node.kwarg.arg))

    return params


# ---------------------------------------------------------------------------
# Main visitor class
# ---------------------------------------------------------------------------

class _CodeVisitor(ast.NodeVisitor):
    """
    Walks the AST of a single Python file and collects structural metadata.

    How it works
    ------------
    ast.NodeVisitor provides a generic_visit() method that descends into
    child nodes. We override specific visit_* methods to intercept the
    node types we care about.

    We maintain a 'scope stack' to track where we are in the tree:
      - When we enter a ClassDef we push its name onto the stack.
      - When we enter a FunctionDef we push its name onto the stack.
      - When we exit either, we pop the stack.

    The stack lets us:
      - Decide if a FunctionDef is a method (top of stack is a class scope)
        or a nested function (top of stack is a function scope).
      - Build the correct dotted name for symbol IDs.

    Scope stack entries are dicts:
      {"kind": "class" | "function", "name": str, "symbol_id": str}
    """

    def __init__(self, file_path, source_code):
        self.file_path = file_path
        self.source_code = source_code

        # Accumulated results.
        self.symbols = []
        self.imports = []
        self.calls = []

        # Stack that tracks the current nesting context.
        self._scope_stack = []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _current_class_scope(self):
        """
        Return the innermost class scope in the stack, or None.

        We check only the immediate parent. If the immediate parent is a
        function we are inside a nested function, not a method, even if
        there is a class further up the stack.
        """
        if self._scope_stack and self._scope_stack[-1]["kind"] == "class":
            return self._scope_stack[-1]
        return None

    def _current_function_scope(self):
        """Return the innermost function scope in the stack, or None."""
        for scope in reversed(self._scope_stack):
            if scope["kind"] == "function":
                return scope
        return None

    def _build_qualified_name_parts(self, new_name):
        """
        Build the list of name parts for the symbol ID including new_name.

        Collects the name from every scope in the stack, then appends
        new_name. Example for a method inside a class:
            stack = [{"kind": "class", "name": "AuthService", ...}]
            new_name = "login_user"
            result = ["AuthService", "login_user"]
        """
        parts = [scope["name"] for scope in self._scope_stack]
        parts.append(new_name)
        return parts

    def _get_parent_id(self):
        """Return the symbol_id of the immediate enclosing scope, or None."""
        if self._scope_stack:
            return self._scope_stack[-1]["symbol_id"]
        return None

    def _get_caller_id(self):
        """
        Return the symbol_id of the nearest enclosing *function* scope.

        Call nodes belong to the function they appear inside, not the
        surrounding class.
        """
        scope = self._current_function_scope()
        if scope:
            return scope["symbol_id"]
        return None

    # ------------------------------------------------------------------
    # Visitor methods
    # ------------------------------------------------------------------

    def visit_ClassDef(self, node):
        """
        Handle a class definition.

        Captures: name, line range, docstring, base classes.
        Then descends into the class body to find methods.
        """
        name_parts = self._build_qualified_name_parts(node.name)
        symbol_id = _make_symbol_id(self.file_path, *name_parts)
        parent_id = self._get_parent_id()

        # Collect base class names (inheritance).
        bases = []
        for base in node.bases:
            if isinstance(base, ast.Name):
                bases.append(base.id)
            elif isinstance(base, ast.Attribute):
                # e.g. module.BaseClass -- walk the chain
                parts = []
                b = base
                while isinstance(b, ast.Attribute):
                    parts.append(b.attr)
                    b = b.value
                if isinstance(b, ast.Name):
                    parts.append(b.id)
                parts.reverse()
                bases.append(".".join(parts))

        self.symbols.append({
            "symbol_id": symbol_id,
            "name": node.name,
            "type": "class",
            "file_path": self.file_path,
            "start_line": node.lineno,
            "end_line": getattr(node, "end_lineno", None),
            "parent_id": parent_id,
            "parameters": [],
            "docstring": ast.get_docstring(node),
            "bases": bases,
        })

        # Push this class onto the scope stack, then visit its body.
        self._scope_stack.append({
            "kind": "class",
            "name": node.name,
            "symbol_id": symbol_id,
        })
        self.generic_visit(node)
        self._scope_stack.pop()

    def _visit_function(self, node, is_async):
        """
        Shared logic for FunctionDef and AsyncFunctionDef.

        Determines whether the function is:
          - a standalone function  (module-level)
          - a method               (immediate parent scope is a class)
          - a nested function      (immediate parent scope is a function)
          - an async variant of any of the above
        """
        name_parts = self._build_qualified_name_parts(node.name)
        symbol_id = _make_symbol_id(self.file_path, *name_parts)
        parent_id = self._get_parent_id()

        # Decide the symbol type based on what is immediately above us.
        enclosing_class = self._current_class_scope()
        if enclosing_class is not None:
            sym_type = "async_method" if is_async else "method"
        elif self._current_function_scope() is not None:
            sym_type = "nested_function"
        else:
            sym_type = "async_function" if is_async else "function"

        params = _get_param_names(node.args)

        self.symbols.append({
            "symbol_id": symbol_id,
            "name": node.name,
            "type": sym_type,
            "file_path": self.file_path,
            "start_line": node.lineno,
            "end_line": getattr(node, "end_lineno", None),
            "parent_id": parent_id,
            "parameters": params,
            "docstring": ast.get_docstring(node),
            "bases": [],
        })

        # Push this function onto the scope stack, then visit its body.
        self._scope_stack.append({
            "kind": "function",
            "name": node.name,
            "symbol_id": symbol_id,
        })
        self.generic_visit(node)
        self._scope_stack.pop()

    def visit_FunctionDef(self, node):
        """Handle a regular (synchronous) function or method."""
        self._visit_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node):
        """Handle an async function or method (defined with 'async def')."""
        self._visit_function(node, is_async=True)

    def visit_Import(self, node):
        """
        Handle a plain 'import X' or 'import X as Y' statement.

        For 'import os.path'      -> module=None, name="os.path", alias=None
        For 'import os.path as p' -> module=None, name="os.path", alias="p"
        """
        for alias in node.names:
            self.imports.append({
                "module": None,
                "name": alias.name,
                "alias": alias.asname,
                "line_number": node.lineno,
            })
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        """
        Handle a 'from X import Y' statement.

        For 'from database import get_user':
            module="database", name="get_user", alias=None
        For 'from utils.validation import validate_email as ve':
            module="utils.validation", name="validate_email", alias="ve"
        """
        for alias in node.names:
            self.imports.append({
                "module": node.module,
                "name": alias.name,
                "alias": alias.asname,
                "line_number": node.lineno,
            })
        self.generic_visit(node)

    def visit_Call(self, node):
        """
        Handle a function/method call expression.

        We capture the callee name as a raw string without trying to
        resolve which exact definition it points to -- that would require
        runtime type information and is deferred to a later phase.
        """
        callee = _get_callee_name(node)
        if callee is not None:
            self.calls.append({
                "callee_name": callee,
                "caller_id": self._get_caller_id(),
                "line_number": node.lineno,
            })
        # Always descend so we catch calls inside arguments too.
        self.generic_visit(node)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_file(file_path, root_dir=""):
    """
    Parse a single Python source file and return its structural metadata.

    Parameters
    ----------
    file_path : str
        The path to the Python file. When root_dir is provided, the
        relative path (file_path relative to root_dir) is stored inside
        the result. When root_dir is empty, file_path is used as-is
        for symbol IDs.

    root_dir : str, optional
        The project root directory. Used to compute the relative path
        stored in symbol IDs and the returned dict. Defaults to "" which
        means file_path is already the relative (display) path.

    Returns
    -------
    dict
        See module docstring for the full structure.
        Always returns a dict -- never raises an exception.

    Notes
    -----
    If the file has a SyntaxError (or any other read/parse failure) the
    returned dict will have parse_ok=False and error=<message>, with
    empty lists for symbols, imports, and calls. This allows the caller
    to continue processing other files without crashing.
    """

    # 1. Compute the relative path used in symbol IDs.
    if root_dir:
        try:
            rel_path = os.path.relpath(file_path, root_dir)
        except ValueError:
            # On Windows, relpath can fail if paths are on different drives.
            rel_path = file_path
        rel_path = rel_path.replace(os.sep, "/")
    else:
        # file_path is already the relative path (e.g. "models/user.py").
        rel_path = file_path.replace(os.sep, "/")

    # 2. Read source code.
    try:
        with open(file_path, "r", encoding="utf-8-sig", errors="replace") as fh:
            source = fh.read()
    except OSError as exc:
        return _failure_result(rel_path, "Could not read file: {}".format(exc))

    # Count lines: number of newlines + 1 if file is non-empty and
    # does not end with a newline. This matches most editors' line count.
    if source:
        line_count = source.count("\n") + (0 if source.endswith("\n") else 1)
    else:
        line_count = 0

    # 3. Parse the source into an AST.
    try:
        tree = ast.parse(source, filename=rel_path)
    except SyntaxError as exc:
        return _failure_result(
            rel_path,
            "SyntaxError at line {}: {}".format(exc.lineno, exc.msg),
            source=source,
            line_count=line_count,
        )
    except Exception as exc:
        return _failure_result(
            rel_path,
            "Unexpected parse error: {}".format(exc),
            source=source,
            line_count=line_count,
        )

    # 4. Walk the AST with our visitor.
    visitor = _CodeVisitor(file_path=rel_path, source_code=source)
    visitor.visit(tree)

    return {
        "file_path": rel_path,
        "line_count": line_count,
        "source_code": source,
        "parse_ok": True,
        "error": None,
        "symbols": visitor.symbols,
        "imports": visitor.imports,
        "calls": visitor.calls,
    }


def parse_repository(root_dir, python_files):
    """
    Parse every Python file in the list and return a list of result dicts.

    Parameters
    ----------
    root_dir : str
        The project root. Used to compute relative paths and to build
        absolute paths from the relative paths in python_files.

    python_files : list[str]
        List of relative paths as returned by scanner.scan_repository().

    Returns
    -------
    list[dict]
        One result dict per file. Files that fail to parse are included
        with parse_ok=False; the rest of the list is unaffected.
    """
    results = []
    for rel_path in python_files:
        abs_path = os.path.join(root_dir, rel_path.replace("/", os.sep))
        result = parse_file(abs_path, root_dir=root_dir)
        results.append(result)
    return results


# ---------------------------------------------------------------------------
# Internal helper for failed parses
# ---------------------------------------------------------------------------

def _failure_result(rel_path, error_msg, source="", line_count=0):
    """Return a standardised failure dict so callers always get the same shape."""
    return {
        "file_path": rel_path,
        "line_count": line_count,
        "source_code": source,
        "parse_ok": False,
        "error": error_msg,
        "symbols": [],
        "imports": [],
        "calls": [],
    }
