# CODESEEK — Complete Study Booklet

> **Who this file is for:** You built CodeSeek with AI assistance and now want to fully understand it for demo, viva, interview, and self-learning. This document explains everything from the ground up. No prior web-development knowledge is assumed.

---

## Table of Contents

1. [What is CodeSeek?](#1-what-is-codeseek)
2. [Overall Architecture](#2-overall-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Frontend vs Backend From Zero](#4-frontend-vs-backend-from-zero)
5. [FastAPI and API Concepts From Zero](#5-fastapi-and-api-concepts-from-zero)
6. [ZIP Upload Flow](#6-zip-upload-flow)
7. [Scanner Module](#7-scanner-module)
8. [AST From Absolute Zero](#8-ast-from-absolute-zero)
9. [Parser Module](#9-parser-module)
10. [Indexer](#10-indexer)
11. [SQLite Database](#11-sqlite-database)
12. [Search System](#12-search-system)
13. [Dependency Analysis](#13-dependency-analysis)
14. [NetworkX](#14-networkx)
15. [React Flow](#15-react-flow)
16. [React Frontend](#16-react-frontend)
17. [Each CodeSeek Screen](#17-each-codeseek-screen)
18. [Update / Re-index Flow](#18-update--re-index-flow)
19. [Error Handling](#19-error-handling)
20. [Testing](#20-testing)
21. [Git and GitHub](#21-git-and-github)
22. [Real Problems Encountered During Development](#22-real-problems-encountered-during-development)
23. [Security Considerations](#23-security-considerations)
24. [Current Limitations](#24-current-limitations)
25. [Why This Architecture Was Chosen](#25-why-this-architecture-was-chosen)
26. [End-to-End Request Traces](#26-end-to-end-request-traces)
27. [Demo Preparation](#27-demo-preparation)
28. [Viva Preparation — 75+ Questions](#28-viva-preparation--75-questions)
29. [Glossary](#29-glossary)
30. [Final Revision Sheets](#30-final-revision-sheets)

---

## 1. What is CodeSeek?

### The Problem It Solves

When you inherit a large Python codebase — especially one written by someone else — you face a common struggle: you cannot easily answer questions like:

- "Where is the function that handles login?"
- "Which files import `database.py`?"
- "What methods does the `User` class have?"
- "Which function calls `validate_email`?"

Traditional text editors let you search for text, but that is slow and noisy. IDEs help, but they require installing the project's dependencies, which can be complex. CodeSeek solves this differently: it **reads** your Python code without running it, extracts all structural information (functions, classes, imports, calls), stores it in a local database, and gives you a web interface to search and browse.

### Who Would Use It

- A developer who receives a new Python project and wants a map before diving in.
- A student who built a project collaboratively and needs to understand the whole codebase quickly.
- A code reviewer who wants to see dependency relationships at a glance.

### What CodeSeek Does

- Accepts a Python project as a ZIP file.
- Extracts and scans for Python files.
- Parses every Python file with Python's own AST module.
- Extracts functions, methods, classes, parameters, docstrings, imports, and function calls.
- Stores all this in a local SQLite database.
- Lets you search, browse, and visualize the project through a React web interface.
- Shows file dependency graphs and function-call graphs.
- Displays repository statistics.

### What CodeSeek Does NOT Do

- It does **not** execute your uploaded code. Ever.
- It does **not** understand Java, C, JavaScript, or any language other than Python.
- It does **not** perform AI/semantic search.
- It does **not** authenticate users or run in the cloud.
- It does **not** watch for file changes or do incremental updates.
- It does **not** connect to GitHub.

### Complete High-Level User Journey

```
User selects a Python project .zip
            |
            v
Browser sends the file to the backend (POST /projects/analyze-upload)
            |
            v
Backend validates the ZIP (extension + real ZIP check + Zip Slip check)
            |
            v
Backend extracts the ZIP to  backend/uploads/<uuid>/
            |
            v
Wrapper-folder detection (if zip has one top-level folder, step into it)
            |
            v
Scanner recursively finds all .py files  ->  [app.py, services/auth.py, ...]
            |
            v
Parser reads each file and builds AST -> extracts symbols, imports, calls
            |
            v
Indexer stores everything in SQLite (projects, files, symbols, imports, calls)
            |
            v
Backend responds with project_id
            |
            v
Frontend fetches project overview -> navigates to Dashboard
            |
            v
User browses files, searches for symbols, views graphs and statistics
```

Each stage is explained in detail in the sections that follow.

---

## 2. Overall Architecture

### Architecture Diagram

```
+----------------------------------------------------------------+
|                        USER'S BROWSER                          |
|                                                                |
|   React App (Vite dev server on port 5173)                     |
|   +---------+ +--------+ +-----------+ +------+ +----------+  |
|   | Home/   | | Dash-  | |  File /   | |Graph | |Statistics|  |
|   | Upload  | | board  | | Func/Class| | View | |          |  |
|   +----+----+ +----+---+ +-----+-----+ +--+---+ +----+-----+  |
|        |           |           |           |          |         |
+--------+-----------+-----------+-----------+----------+---------+
         |           |  HTTP / JSON API calls|          |
         |           |  (fetch, FormData)    |          |
         v           v           v           v          v
+----------------------------------------------------------------+
|         FastAPI Backend (Uvicorn on port 8000)                  |
|                        backend/app/main.py                      |
|                                                                 |
|  POST /projects/analyze-upload  <-- ZIP file + name            |
|  GET  /projects/{id}            <-- overview                   |
|  GET  /projects/{id}/files      <-- file list                  |
|  GET  /projects/{id}/symbols    <-- symbols                    |
|  GET  /projects/{id}/search     <-- ranked search results      |
|  GET  /files/{id}               <-- source code                |
|  GET  /symbols/{symbol_id}      <-- symbol detail              |
|  GET  /projects/{id}/dependencies/files   <-- file graph       |
|  GET  /projects/{id}/dependencies/functions <-- call graph     |
|  GET  /projects/{id}/stats      <-- graph metrics              |
|  POST /projects/{id}/update-upload <-- re-index with new ZIP   |
+------------------+-------------------------------+-------------+
                   |                               |
         +---------v----------+       +------------v-----------+
         |  Analysis Pipeline |       |    SQLite Database     |
         |                    |       |    codeseek.db         |
         |  scanner.py        |       |                        |
         |  parser.py         |------>|  projects              |
         |  indexer.py        |       |  files                 |
         |  search.py         |<------|  symbols               |
         |  graphs.py         |       |  imports               |
         |                    |       |  calls                 |
         +--------------------+       +------------------------+
                   |
         +---------v---------+
         |   uploads/        |
         |   <uuid>/         |  <- Extracted project files
         |   (on disk)       |    (retained for source viewing)
         +-------------------+
```

### How Data Moves

| Stage | What happens |
|-------|-------------|
| **Upload** | Browser sends `multipart/form-data` to backend |
| **Extraction** | Backend writes zip to temp file, extracts to `uploads/<uuid>/` |
| **Scanning** | `scanner.py` walks directory and returns relative `.py` paths |
| **Parsing** | `parser.py` reads each file, runs `ast.parse()`, extracts symbols |
| **Storage** | `indexer.py` writes everything to SQLite via `database/core.py` |
| **Search** | `search.py` queries SQLite with weighted scoring, returns JSON |
| **Graphs** | `graphs.py` reads SQLite, builds NetworkX DiGraph, serializes to JSON |
| **Frontend** | React components `fetch()` the JSON from endpoints and render it |

---

## 3. Tech Stack

Every technology actually used in CodeSeek is listed here with its role and why it was chosen.

### Python

**What it is:** A general-purpose programming language known for its readable syntax and rich standard library.

**Why CodeSeek uses it:** Python's built-in `ast` module is what makes CodeSeek possible without external tools. It also has excellent web framework support (FastAPI) and data-science libraries (NetworkX).

**Responsibility:** The entire backend — scanning, parsing, indexing, searching, graph building — is Python.

**Why not Java/Go/Node?** Those would require a third-party AST parser for Python code. Python's own `ast` module is battle-tested and built in.

### FastAPI

**What it is:** A modern Python web framework for building APIs. It automatically generates interactive documentation, validates input, and is very fast.

**Why CodeSeek uses it:** FastAPI makes it trivial to define API endpoints with type hints. It handles JSON serialization, multipart file uploads, and request validation automatically.

**File:** `backend/app/main.py`

**Responsibility:** Defines all 11 API endpoints. Receives HTTP requests from the React frontend, calls the appropriate service, and returns JSON responses.

### Uvicorn

**What it is:** An ASGI (Asynchronous Server Gateway Interface) server. It is what actually runs the FastAPI application and listens for HTTP connections.

**Why required:** FastAPI is just a framework that defines routes. Uvicorn is the actual server process that binds to port 8000 and handles incoming connections.

**Why not Flask/Django?** FastAPI with Uvicorn is faster and more modern. Flask's ecosystem requires more boilerplate for async uploads. Django is overkill for an MVP API.

### React

**What it is:** A JavaScript library for building user interfaces out of reusable "components". Maintained by Meta (Facebook).

**Why CodeSeek uses it:** React makes it easy to build complex, interactive UIs. When data changes (e.g., a search result arrives), React automatically updates only the affected part of the screen.

**Version:** React 19 (see `frontend/package.json`).

**Responsibility:** Renders every screen the user sees: the upload form, dashboard, search results, file tree, function list, class list, graphs, and statistics.

### Vite

**What it is:** A build tool and development server for JavaScript projects. Very fast because it uses ES modules natively during development.

**Why CodeSeek uses it:** Vite starts a local development server at `http://localhost:5173`, serves the React app, and automatically reloads the browser when you save a file.

**File:** `frontend/vite.config.js`

**Why not Create React App?** Create React App is slower and no longer actively maintained. Vite is the current standard.

### Node.js / npm

**What it is:** Node.js is a JavaScript runtime that lets you run JavaScript outside the browser. npm (Node Package Manager) installs JavaScript libraries.

**Why CodeSeek uses it:** Vite and React need Node.js to run. npm downloads libraries like `@xyflow/react` and React itself from the internet into the `node_modules` folder.

**Responsibility:** Development tooling only. The final user-facing application is HTML + CSS + JavaScript that runs in any browser.

### SQLite

**What it is:** A file-based relational database. The entire database is a single `.db` file. No separate database server process is needed.

**Why CodeSeek uses it:** Perfect for a local, single-user MVP. No installation, no configuration, no server to start. Python has built-in support for SQLite via the `sqlite3` module.

**File:** `backend/codeseek.db` (created automatically when first project is indexed)
**Schema module:** `backend/app/database/core.py`

**Why not PostgreSQL/MySQL?** Those require a separate server process to run. For a college project demo, SQLite is much simpler to set up and explain.

### Python `ast` module

**What it is:** A standard library module (built into Python) that can parse Python source code into an Abstract Syntax Tree.

**Why CodeSeek uses it:** It converts source code into a tree of structured Python objects that you can walk and inspect. No regex, no string parsing, no third-party dependencies needed.

**File:** `backend/app/services/parser.py`

**Why not regex?** Regular expressions cannot reliably understand nested structures like classes-inside-classes, or distinguish `def foo():` at module level from `def foo():` inside a class.

### NetworkX

**What it is:** A Python library for creating, manipulating, and analyzing graphs and networks. A "graph" here means nodes connected by edges — not a visual chart.

**Why CodeSeek uses it:** NetworkX stores the file dependency graph and function-call graph in memory. It computes metrics like in-degree, out-degree, and top nodes. It does the graph math.

**File:** `backend/app/services/graphs.py`
**Install:** Listed in `backend/requirements.txt`

**What NetworkX does NOT do:** It does not render graphs on screen. That is React Flow's job.

### React Flow / @xyflow/react

**What it is:** A React component library for rendering interactive, draggable node-and-edge graphs in the browser.

**Why CodeSeek uses it:** NetworkX builds the graph structure in Python. React Flow renders that structure as a visual canvas with draggable nodes and animated edges in the browser.

**Package name:** `@xyflow/react` (version 12.x, see `frontend/package.json`)

**File:** `frontend/src/components/DependencyGraphs.jsx`

**Why not D3.js?** D3 is very powerful but requires a lot of custom code. React Flow is purpose-built for node-edge diagrams and integrates naturally with React state.

### pytest

**What it is:** The most popular Python testing framework. Lets you write functions that start with `test_` and automatically runs them, reporting which pass or fail.

**Why CodeSeek uses it:** Automated tests verify that the scanner, parser, indexer, search engine, graphs, API endpoints, and ZIP upload all behave correctly. They catch regressions when you change code.

**Files:** `backend/tests/test_scanner.py`, `test_parser.py`, `test_indexer.py`, `test_search.py`, `test_graphs.py`, `test_api.py`, `test_upload.py`

### Git / GitHub

**Git:** A version control system that tracks every change made to files over time. **GitHub:** A website that hosts Git repositories online, providing backup and sharing.

---

## 4. Frontend vs Backend From Zero

### What "Frontend" Means

The **frontend** is everything the user sees and interacts with — the buttons, forms, tables, graphs, and text. In CodeSeek, the frontend is a React application that runs entirely inside the browser.

The frontend is served by a Vite development server at **port 5173**. When you open `http://localhost:5173` in your browser, the browser downloads the React JavaScript files and runs them locally.

### What "Backend" Means

The **backend** is a program running on your own machine (or a server) that processes data, runs code, and stores information. In CodeSeek, the backend is a Python FastAPI application.

The backend is served by Uvicorn at **port 8000**. It receives requests, runs analysis, talks to the database, and sends back data.

### What "Client" and "Server" Mean

- **Client:** The program making the request — in CodeSeek, that is the browser/React app.
- **Server:** The program responding to requests — in CodeSeek, that is the FastAPI/Uvicorn backend.

### What "localhost" Means

"localhost" is a special name that always refers to **your own computer**. It is the same as `127.0.0.1`. When you run both CodeSeek servers on your machine:

- `http://localhost:5173` — Frontend (React/Vite)
- `http://localhost:8000` — Backend (FastAPI/Uvicorn)
- `http://localhost:8000/docs` — Interactive API documentation

### Why the Browser Cannot Directly Perform Analysis

The browser runs JavaScript — a sandboxed language with no file system access, no ability to run `ast.parse()`, and no access to Python. The backend exists specifically to do what the browser cannot: run Python code, parse Python AST, write to SQLite.

### Why Frontend and Backend Communicate Through APIs

APIs define a structured way for two programs to talk. The frontend does not know how Python works. The backend does not know how React works. They communicate by exchanging standardized messages (HTTP requests and JSON responses) through the API.

---

## 5. FastAPI and API Concepts From Zero

### What an API Is

An **API** (Application Programming Interface) is a defined set of rules for how one piece of software can ask another piece of software for something and what it will receive back. In CodeSeek, the API is the set of URLs that the React frontend can call to get data.

### Endpoint

An **endpoint** is one specific URL + HTTP method combination. For example, `GET /projects/1/search?q=login` is one endpoint.

### HTTP Request and Response

HTTP (HyperText Transfer Protocol) is the language browsers and servers use to communicate.

A **request** is sent from client to server. It has: a **method** (GET, POST...), a **URL**, optionally a **body** (data), optionally **headers** (metadata).

A **response** is sent from server to client. It has: a **status code**, a **body** (usually JSON), and headers.

### JSON

**JSON** (JavaScript Object Notation) is a text format for structured data. Example:

```json
{
  "name": "start_application",
  "type": "function",
  "start_line": 10
}
```

Both the Python backend and the JavaScript frontend understand JSON natively.

### GET vs POST

| Method | Purpose | Has body? | CodeSeek use |
|--------|---------|-----------|--------------|
| GET | Retrieve data | Usually no | Search, get files, get symbols |
| POST | Send data / trigger action | Yes | Upload ZIP, update project |

### HTTP Status Codes

| Code | Meaning | When CodeSeek returns it |
|------|---------|--------------------------|
| 200 | OK | Successful response |
| 400 | Bad Request | Invalid ZIP, non-ZIP file, Zip Slip |
| 404 | Not Found | Project ID does not exist |
| 422 | Unprocessable Entity | FastAPI validation failed (e.g., empty search query) |
| 500 | Internal Server Error | Unexpected backend failure |

### Path Parameters

Values embedded in the URL path. In `/projects/{project_id}`, `{project_id}` is a path parameter. Calling `/projects/42` gives FastAPI `project_id=42`.

### Query Parameters

Values passed after `?` in the URL. In `/projects/1/search?q=login`, `q=login` is a query parameter.

### Form Data and Multipart Upload

Some endpoints receive data as HTML form fields. The upload endpoint receives `name` (text) and `file` (binary) as multipart form data. React's `FormData` object builds this encoding automatically.

### CORS

**CORS** (Cross-Origin Resource Sharing) is a browser security feature that blocks JavaScript from calling URLs on a different origin (different port counts as different origin) unless the server explicitly allows it.

CodeSeek's `main.py` adds `CORSMiddleware` allowing origins `["http://localhost:3000", "http://localhost:5173"]`. This tells browsers it is safe for the React app on port 5173 to call the backend on port 8000.

### Swagger /docs

Visiting `http://localhost:8000/docs` shows FastAPI's auto-generated interactive API documentation. You can test every endpoint directly in the browser — great for development and demonstration.

### Complete Endpoint Table

All endpoints are defined in `backend/app/main.py`.

| Method | Path | Purpose | Input | Output |
|--------|------|---------|-------|--------|
| POST | `/projects/analyze` | Index a local directory (no ZIP) | JSON `{name, directory_path}` | `{message, project_id}` |
| POST | `/projects/analyze-upload` | Upload ZIP, extract, and index | Form: `name` + `file` (ZIP) | `{message, project_id}` |
| POST | `/projects/{project_id}/update-upload` | Re-index existing project | Path: `project_id`; Form: `file` (ZIP) | `{message, project_id}` |
| GET | `/projects/{project_id}` | Project overview + counts | Path: `project_id` | JSON with name, indexed_at, counts |
| GET | `/projects/{project_id}/files` | List all indexed files | Path: `project_id` | Array of file objects |
| GET | `/files/{file_id}` | File details including source | Path: `file_id` | File object with source field |
| GET | `/projects/{project_id}/symbols` | List symbols, optionally filtered | Path: `project_id`; Query: `type` | Array of symbol objects |
| GET | `/projects/{project_id}/search` | Weighted search | Path: `project_id`; Query: `q` (min 1 char) | Array of ranked result objects |
| GET | `/symbols/{symbol_id:path}` | Get symbol by deterministic ID | Path: full symbol ID (may have `/`) | Symbol object with params, bases, docstring |
| GET | `/projects/{project_id}/dependencies/files` | File dependency graph | Path: `project_id` | `{nodes, edges, unresolved}` |
| GET | `/projects/{project_id}/dependencies/functions` | Function-call graph | Path: `project_id` | `{nodes, edges, unresolved}` |
| GET | `/projects/{project_id}/stats` | Graph metrics | Path: `project_id` | `{file_dependencies, function_calls}` |

---

## 6. ZIP Upload Flow

### Step 1 — React Builds FormData

In `frontend/src/App.jsx`, `handleAnalyze` runs:

```javascript
const formData = new FormData();
formData.append('name', name.trim());
formData.append('file', selectedFile, selectedFile.name);
```

`FormData` packages text fields and binary file data into `multipart/form-data` format. The browser sets the correct `Content-Type` header automatically. **Do NOT set Content-Type manually** (the code comment says this explicitly).

### Step 2 — Browser Sends POST Request

```javascript
fetch('http://127.0.0.1:8000/projects/analyze-upload', {
    method: 'POST',
    body: formData,
})
```

### Step 3 — Backend Validates File Extension

```python
if not file.filename or not file.filename.lower().endswith(".zip"):
    raise HTTPException(status_code=400, detail="Only .zip files are accepted")
```

### Step 4 — Validate as Real ZIP

Uploaded bytes are written to a temp file, then `zipfile.is_zipfile()` checks it is a genuine ZIP archive, not just a renamed `.tar.gz`.

### Step 5 — Zip Slip / Path Traversal Check

Every ZIP member is checked before extraction:

```python
member_path = os.path.realpath(os.path.join(extract_root, member.filename))
if not member_path.startswith(extract_root + os.sep):
    shutil.rmtree(extract_root, ignore_errors=True)
    raise HTTPException(status_code=400, detail="... Zip Slip ...")
```

`os.path.realpath` resolves all `../` sequences. If the resolved path escapes the target directory, the ZIP is rejected.

### Step 6 — Extraction to UUID Directory

```python
extract_root = os.path.realpath(
    os.path.join(_UPLOADS_ROOT, str(uuid.uuid4()))
)
```

Each upload gets its own UUID subdirectory in `backend/uploads/` to avoid collisions.

### Step 7 — Wrapper Folder Detection

GitHub-exported ZIPs often have a top-level folder like `project-main/`. CodeSeek detects this and steps into it so file paths are clean (`app.py` not `project-main/app.py`).

### Step 8 — Analysis Pipeline

`index_project(project_name, analyze_dir)` is called — scanner, parser, and indexer run.

### Step 9 — Extracted Folders Remain on Disk

**Important limitation:** Extracted folders are never deleted. They are kept so the File Explorer can read source code on demand from `GET /files/{id}`. Manual cleanup of `backend/uploads/` is required periodically.

### Why Uploaded Code Is NEVER Executed

CodeSeek calls only `ast.parse()`, which reads source text and builds a tree. It never evaluates or runs the code. No `exec()`, `eval()`, or subprocess calls on user code.

---

## 7. Scanner Module

**File:** `backend/app/services/scanner.py`

### What Repository Scanning Means

Scanning walks a directory tree to find all Python files. It is like exploring a file manager and noting every `.py` file.

### The Core Function

```python
def scan_repository(root_dir: str) -> list:
```

Returns a sorted list of relative paths to all `.py` files, e.g., `["app.py", "models/user.py", "services/auth.py"]`.

### Recursion via `os.walk`

`os.walk` recursively yields `(current_dir, subdirs, files)` for every directory. The scanner modifies `subdirs` in place to skip ignored folders:

```python
subdirs[:] = [d for d in subdirs if d not in IGNORED_DIRS]
```

Modifying the list in place tells `os.walk` not to descend into those folders at all.

### Ignored Folders

```python
IGNORED_DIRS = {
    ".git", "__pycache__", ".venv", "venv", "env",
    "node_modules", ".mypy_cache", ".pytest_cache",
    "dist", "build", ".eggs",
}
```

**Why these matter:**
- `.git` — Git history files, not source code
- `__pycache__` — Compiled bytecode, redundant with `.py` files
- `.venv`, `venv`, `env` — Virtual environment with thousands of library files
- `node_modules` — Node.js packages (irrelevant and huge)
- Other entries — Tool-generated caches

Without ignoring these, CodeSeek would waste time indexing irrelevant files.

### Relative Paths and Deterministic Sorting

Paths are made relative with `os.path.relpath()` and normalized to forward slashes. Results are sorted alphabetically for determinism.

---

## 8. AST From Absolute Zero

### What Source Code Is

Source code is text — the Python script you write. A `.py` file is just a text file. The computer does not directly understand that text.

### What Parsing Means

**Parsing** converts text into a structured, machine-understandable representation. Python's interpreter parses source code before running it.

### What an AST Is

**AST** = **Abstract Syntax Tree**. `ast.parse()` converts source code into a tree of Python objects, each representing a structural element.

Think of a sentence: "The cat sat on the mat." A grammar parser breaks it into Subject, Verb, Prepositional Phrase. An AST does the same for code.

For this code:

```python
class Dog:
    def bark(self):
        print("Woof!")
```

The AST (conceptually) looks like:

```
Module
  ClassDef (name="Dog")
    FunctionDef (name="bark")
      args: [self]
      Expr
        Call (func=print, args=["Woof!"])
```

CodeSeek walks this tree and extracts: one class "Dog" and one method "bark" with parameter "self".

### Why Python's Built-in `ast` Module?

1. **No external dependency** — built into Python
2. **Battle-tested** — the same parser Python uses to run code
3. **Complete and accurate** — handles every valid Python construct
4. **Safe** — parses without executing

### Why AST Is Better Than Regex

Regex matches text patterns but cannot understand structure or context. A regex for `def` would match `def` inside strings, comments, or classes equally. The AST knows the nesting context of every token.

### AST Node Types CodeSeek Inspects

| Node type | What it represents | CodeSeek extracts |
|-----------|-------------------|------------------|
| `FunctionDef` | A `def` function or method | Name, params, docstring, line range, parent context |
| `AsyncFunctionDef` | An `async def` function | Same, type becomes `async_function`/`async_method` |
| `ClassDef` | A `class` definition | Name, base classes, docstring, line range |
| `Import` | `import os` | Module name, alias |
| `ImportFrom` | `from os.path import join` | Module, imported name, alias |
| `Call` | Any function call | Callee name, caller context |

### How Function vs Method Is Distinguished

Using a **scope stack** in `_CodeVisitor`. When entering a `ClassDef`, push `{kind: "class", ...}`. When entering a `FunctionDef`:
- Top of stack is class scope → it is a **method**
- Top of stack is function scope → it is a **nested function**
- Stack is empty → it is a standalone **function**

---

## 9. Parser Module

**File:** `backend/app/services/parser.py`

### Symbol Extraction

The `_CodeVisitor` class extends `ast.NodeVisitor`. Calling `visitor.visit(tree)` walks the AST and triggers `visit_ClassDef`, `visit_FunctionDef`, `visit_Import`, and `visit_Call` methods. Each matching node appends a dict to `visitor.symbols`, `visitor.imports`, or `visitor.calls`.

### Start/End Line Numbers

Every AST node has `node.lineno` (start) and `node.end_lineno` (end). These are stored so the frontend can slice source code to show snippets.

### Parameters

`_get_param_names(args_node)` collects regular positional args, `*args`, keyword-only args, `**kwargs`, including `self` and `cls`.

### Docstrings

`ast.get_docstring(node)` returns the first string literal in a function/class body as the docstring, or `None`.

### Bases / Inheritance

For `ClassDef` nodes, `node.bases` lists parent class expressions. The visitor walks each to produce strings like `"BaseUser"` or `"module.BaseClass"`.

### Imports

- `visit_Import` handles `import os`, `import os.path as p` → `{module: None, name: "os.path", alias: ...}`
- `visit_ImportFrom` handles `from database import get_user` → `{module: "database", name: "get_user", alias: None}`

### Calls

`visit_Call` captures every call. `_get_callee_name` produces:
- `foo()` → `"foo"`
- `obj.method()` → `"obj.method"`
- `a.b.c()` → `"a.b.c"`

The `caller_id` is the symbol ID of the nearest enclosing function (found by searching the scope stack).

### Deterministic Symbol IDs

Built by `_make_symbol_id(file_path, *name_parts)`:

```python
return "{}::{}".format(normalised_path, ".".join(name_parts))
```

Examples from the `sample_shop` project:

| Symbol | Deterministic ID |
|--------|-----------------|
| `start_application` in `app.py` | `app.py::start_application` |
| `AuthService` class in `services/auth.py` | `services/auth.py::AuthService` |
| `login_user` method of `AuthService` | `services/auth.py::AuthService.login_user` |
| `User` class in `models/user.py` | `models/user.py::User` |
| `display_name` method of `User` | `models/user.py::User.display_name` |

**Why deterministic IDs are useful:**
1. Stable — same function always gets the same ID regardless of auto-increment row numbers
2. Human-readable — immediately shows which file and class a symbol belongs to
3. Cross-referenceable — the `calls` table stores `caller_symbol_id` as text; graph builder looks up by ID
4. URL-addressable — `GET /symbols/services/auth.py::AuthService.login_user` works directly

### Syntax Error Handling

If `ast.parse()` throws `SyntaxError`, `parse_file()` catches it and returns:

```python
{
    "file_path": rel_path, "parse_ok": False,
    "error": "SyntaxError at line N: ...",
    "symbols": [], "imports": [], "calls": []
}
```

The indexer stores this record. All other files continue parsing normally. One broken file never crashes the whole project.

---

## 10. Indexer

**File:** `backend/app/services/indexer.py`

### What Indexing Means

**Indexing** transforms raw source files into a structured, searchable database. Like a book's index that tells you which page mentions "validation" instead of making you read the whole book.

### Why Index Instead of Reparse Every Request

Re-reading and re-parsing files on every search query would take seconds. The indexed SQLite database makes searches run in milliseconds.

### How Scanner + Parser + Database Connect

`index_project()` orchestrates:

```python
init_db(db_path)
python_files = scan_repository(root_dir)
parse_results = parse_repository(root_dir, python_files)
# for each result: INSERT file, symbols, imports, calls
return project_id
```

### Normal Indexing (New Project)

```python
cursor.execute("DELETE FROM projects WHERE name = ?", (project_name,))
cursor.execute("INSERT INTO projects (name, root_path) VALUES (?, ?)", ...)
project_id = cursor.lastrowid
```

Before inserting, any existing project with the same name is deleted. CASCADE deletes handle child tables automatically.

### Re-indexing (Update Flow)

When `update_project_id` is provided:

```python
cursor.execute("UPDATE projects SET root_path=?, indexed_at=CURRENT_TIMESTAMP WHERE id=?", ...)
cursor.execute("DELETE FROM calls WHERE project_id=?", ...)
cursor.execute("DELETE FROM imports WHERE project_id=?", ...)
cursor.execute("DELETE FROM symbols WHERE project_id=?", ...)
cursor.execute("DELETE FROM files WHERE project_id=?", ...)
project_id = update_project_id
```

The project row is **updated** (not deleted), preserving the `id`. Child tables are wiped and rebuilt.

### Full Wipe-and-Rebuild Strategy

CodeSeek does not do incremental indexing. Every re-index is a complete rebuild from scratch. Simpler and eliminates stale data risk, at the cost of slightly longer processing for very large projects.

---

## 11. SQLite Database

**File:** `backend/app/database/core.py`

### Database Concepts From Zero

- **Database:** An organized collection of structured data stored persistently (in a file: `codeseek.db`).
- **Table:** Like a spreadsheet — named columns and rows of data.
- **Row:** One record (e.g., one Python file).
- **Column:** A named field (e.g., `relative_path`, `line_count`).
- **Primary Key:** Uniquely identifies each row. CodeSeek uses auto-increment `id` in every table.
- **Foreign Key:** A column referencing the primary key of another table. `files.project_id` references `projects.id`.
- **Relationship:** The logical connection between tables through foreign keys.
- **Cascade Delete:** Deleting a parent row automatically deletes all related child rows.

### CodeSeek Database Tables

#### `projects` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-assigned unique number |
| `name` | TEXT | Project name given by user |
| `root_path` | TEXT | Absolute path to extracted project directory |
| `indexed_at` | TIMESTAMP | When last indexed |

#### `files` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto number |
| `project_id` | INTEGER FK | Parent project |
| `relative_path` | TEXT | e.g., `services/auth.py` |
| `language` | TEXT | Always `"python"` in MVP |
| `line_count` | INTEGER | Number of lines |
| `source` | TEXT | Full source code |
| `parse_status` | BOOLEAN | `1` = parsed OK, `0` = SyntaxError |
| `parse_error` | TEXT | Error message if failed, else NULL |

#### `symbols` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto number |
| `deterministic_id` | TEXT | e.g., `services/auth.py::AuthService.login_user` |
| `project_id` | INTEGER FK | Parent project |
| `file_id` | INTEGER FK | Parent file |
| `name` | TEXT | Simple name: `"login_user"` |
| `symbol_type` | TEXT | `function`, `async_function`, `method`, `async_method`, `nested_function`, `class` |
| `start_line` | INTEGER | First line |
| `end_line` | INTEGER | Last line |
| `parent_id` | TEXT | deterministic_id of enclosing scope, or NULL |
| `parameters` | TEXT | JSON array: `["self", "email"]` |
| `docstring` | TEXT | Docstring text, or NULL |
| `bases` | TEXT | JSON array of base class names (classes only) |

#### `imports` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto number |
| `project_id` | INTEGER FK | Parent project |
| `file_id` | INTEGER FK | File containing this import |
| `module` | TEXT | Module in `from X import Y`, or NULL for `import Z` |
| `imported_name` | TEXT | What is imported |
| `alias` | TEXT | The `as` alias if present |
| `line_number` | INTEGER | Line where import appears |

#### `calls` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto number |
| `project_id` | INTEGER FK | Parent project |
| `file_id` | INTEGER FK | File containing this call |
| `caller_symbol_id` | TEXT | deterministic_id of enclosing function, or NULL |
| `raw_callee_name` | TEXT | Raw call name: `"validate_email"` or `"auth.login"` |
| `line_number` | INTEGER | Line where call appears |

### ER Diagram

```
projects
  |
  +-- files (project_id FK)
  |     +-- symbols   (project_id FK, file_id FK)
  |     +-- imports   (project_id FK, file_id FK)
  |     +-- calls     (project_id FK, file_id FK)
```

### Why SQLite Is Appropriate for This MVP

- Zero setup — no server to install or configure
- Single file — the whole database is `codeseek.db`
- Python built-in — the `sqlite3` module is in the standard library
- More than adequate — handles thousands of rows for small-to-medium Python projects

---

## 12. Search System

**File:** `backend/app/services/search.py`

### What Is Searched

Symbol names, file paths, parameter names, docstrings, import names, callee names, and raw source code.

### Case-Insensitive Matching

All comparisons use SQL `LOWER()` and Python `.lower()`. "USER" and "user" return identical results.

### Weighted Scoring

Each result starts at 0. Points are added for each match type:

| Match type | Score | Why |
|-----------|-------|-----|
| Exact symbol name | **+100** | Strongest signal |
| Symbol name prefix | **+80** | Very intentional |
| Symbol name substring | **+60** | Likely intentional |
| Filename/path match | **+40** | File-level result |
| Parameter match | **+30** | Function signature match |
| Docstring match | **+20** | Documentation match |
| Import or call match | **+15** | Indirect relationship |
| Raw source code match | **+5** | Weakest — text could appear anywhere |

Scores are **additive** — a result can accumulate from multiple match types.

### Top-50 Limit

Results are sorted by score descending, with ties broken alphabetically by ID:

```python
results.sort(key=lambda x: (-x["score"], x["id"]))
return results[:limit]  # default limit=50
```

### Sample Search Step-by-Step

Query: `"validate_email"`

1. Lowercase → `"validate_email"`, build `like_query = "%validate_email%"`
2. Query `calls` table: `AuthService.login_user` calls `validate_email` → call_symbol_ids includes that ID
3. Query `symbols` table: finds symbol `validate_email` in `utils/validation.py`
4. Score symbol: name equals query exactly → **+100**
5. Score `AuthService.login_user`: has call match → **+15**
6. Sort: `validate_email` (100) first
7. Return array

---

## 13. Dependency Analysis

**File:** `backend/app/services/graphs.py`

### File Dependency Graph

- **Node:** Each Python file
- **Edge:** `A → B` means A imports something from B

Built by reading the `imports` table and resolving module names to file paths:

```
"from services.auth import AuthService"
-> module = "services.auth"
-> maps to "services/auth.py"
-> edge: "app.py" → "services/auth.py"
```

### Function-Call Graph

- **Node:** Each function or method
- **Edge:** `A → B` means A calls B

Built by reading the `calls` table and resolving callee names to symbol IDs.

### Internal vs External

- **Internal:** Import resolves to a file in the project → edge is created
- **External:** Import refers to a library (e.g., `import flask`) → goes into `unresolved` list

### Call Resolution Strategy

```python
callee_short = callee.split(".")[-1]  # "obj.method" -> "method"
candidates = symbol_names_map.get(callee_short, [])
if len(candidates) == 1:
    G.add_edge(caller, candidates[0])
else:
    unresolved.append({...})
```

If exactly one symbol has that name, the edge is created. Zero or multiple → unresolved.

### Why Static Call Resolution Is Imperfect

Python is dynamically typed. `obj.process()` could be calling any class's `process()` method. Without running the code, CodeSeek cannot know. Built-in functions (`print`, `len`) are also unresolved because they are not defined in the project files.

---

## 14. NetworkX

**File:** `backend/app/services/graphs.py`

### What NetworkX Is

A Python library for creating and analyzing **graphs** — nodes (points) connected by edges (connections). It is a computation library, not a visualization library.

### What CodeSeek Uses It For

1. Stores file dependency and call graphs as `nx.DiGraph()` objects
2. Computes metrics: node count, edge count, in-degree, out-degree, top nodes
3. Serializes the graph to JSON for the frontend

### In-Degree and Out-Degree

- **In-degree:** How many edges point INTO a node. A file with high in-degree is imported by many others.
- **Out-degree:** How many edges go OUT. A file with high out-degree imports many others.

### Metrics Computed

```python
metrics["avg_in_degree"] = sum(in_degrees.values()) / node_count
metrics["avg_out_degree"] = sum(out_degrees.values()) / node_count
metrics["top_in_degree"] = top 5 by in-degree
```

### What NetworkX Does NOT Do Visually

NetworkX only computes graph structure and metrics. To display the graph visually in the browser, CodeSeek converts it to JSON and sends it to React Flow.

---

## 15. React Flow

**File:** `frontend/src/components/DependencyGraphs.jsx`

### What React Flow Does

React Flow (`@xyflow/react`) renders an interactive, draggable node-edge diagram in the browser. Users can pan, zoom, drag nodes, click for details, and see a mini-map.

### Why It Is Separate from NetworkX

NetworkX runs in Python on the backend (graph math). React Flow runs in JavaScript in the browser (visual rendering). They serve completely different purposes in completely different environments.

### Nodes/Edges Mapping

Backend `graph_to_json()` returns:
```json
{
  "nodes": [{"id": "app.py", "label": "app.py", "line_count": 40}],
  "edges": [{"source": "app.py", "target": "services/auth.py", "type": "imports"}],
  "unresolved": []
}
```

Frontend `toFlowNodes()` and `toFlowEdges()` convert these to React Flow format (adding `position`, `style`, etc.).

### Positions

React Flow needs `x,y` positions for every node. `computeGridPositions()` assigns them in a simple square grid (240px horizontal gap, 120px vertical). Users can then drag nodes to rearrange.

### The Graph Node-ID Bug and Its Fix

**Bug:** The file dependency graph rendered a blank canvas. Nodes appeared in the mini-map but no edges connected them.

**Root cause:** The backend serialized file graph nodes with `id = "file_1"`, `"file_2"` (integer IDs). But edges referenced file paths (`"app.py"`, `"services/auth.py"`) as `source`/`target`. The node IDs and edge endpoints did not match, so React Flow could not draw any edges.

**Fix:** In `DependencyGraphs.jsx`, the `toFlowNodes()` function accepts an `idKey` parameter:

```javascript
const activeIdKey = graphType === 'files' ? 'label' : 'id';
```

For the file graph, `idKey='label'` sets the React Flow node `id` to the file path string (same value used in edge source/target). For the call graph, `idKey='id'` works because edges reference `deterministic_id` which matches node `id`.

**Lesson:** In any graph visualization system, node IDs must exactly match the source/target values in edges. A mismatch produces a completely blank canvas with no error message.

---

## 16. React Frontend

**File:** `frontend/src/`

### React Concepts

**Component:** A JavaScript function returning JSX (HTML-like syntax). Reusable pieces of UI.

**State:** `useState(initial)` creates reactive data. When state changes via the setter, React re-renders.

**Props:** Data passed from parent to child component. In CodeSeek, `overview` is a prop passed from `App.jsx` to all screens.

**useEffect:** Runs side effects (like API fetching) after rendering. Re-runs when listed dependencies change.

**Conditional rendering:** `{loading && <Spinner />}` shows the spinner only when `loading` is true.

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `App.jsx` | Root component. Manages top-level state: active tab, overview data, loading/error. Renders home form or AppShell. |
| `AppShell.jsx` | Persistent layout after project loaded: sidebar with nav buttons, project name, and "Update Project (ZIP)" button. Renders `{children}`. |
| `Dashboard.jsx` | Fetches symbols, files, stats. Shows count boxes: files, symbols, classes, functions, methods, parse health, graph metrics. |
| `Search.jsx` | Controlled input. On submit: `GET /projects/{id}/search?q=...`. Shows ranked results with score and match reasons. |
| `FileExplorer.jsx` | Fetches file list, builds virtual folder tree. On file click: fetches source from `GET /files/{id}`. Shows source in `<pre>`. |
| `FunctionExplorer.jsx` | Fetches symbols, filters to functions/methods. On select: fetches detail from `GET /symbols/{id}`. Shows docstring, params, source snippet. |
| `ClassExplorer.jsx` | Same as FunctionExplorer but for classes. Also shows inheritance and methods list (from `parent_id` matching). |
| `DependencyGraphs.jsx` | Two tabs: file graph and function graph. Lazy fetches each. React Flow canvas, metrics panel, unresolved references panel. |
| `Statistics.jsx` | Fetches stats + files + symbols in parallel (`Promise.all`). Derives total lines, largest files, symbol breakdown. Stat cards with progress bars. |

---

## 17. Each CodeSeek Screen

### Screen 1 — Home / ZIP Upload

**User sees:** CodeSeek logo with gradient, subtitle, project name field, file picker, "Analyze Project" button.

**On submit:** `POST /projects/analyze-upload` with FormData. On success: `GET /projects/{id}` → navigate to dashboard.

**Purpose:** Entry point for project analysis.

### Screen 2 — Loading State

The submit button shows "Uploading & Analyzing…" while the backend processes synchronously. No separate animated progress screen in the current implementation.

### Screen 3 — Dashboard

**Fetches:** `/symbols` (count types), `/files` (parse health), `/stats` (graph metrics).

**Shows:** Total Files, Total Symbols, Imports, Calls, Classes, Functions, Methods, Parse Success/Fail, File Dependency node/edge counts, Function Call node/edge counts.

### Screen 4 — Global Search

**Fetches:** `/projects/{id}/search?q=...` on form submit.

**Shows:** Ranked results with name, type badge, path, line range, score number, match reasons.

### Screen 5 — File Explorer

**Fetches:** `/projects/{id}/files` for tree; `/files/{id}` when file clicked.

**Shows:** Left pane = collapsible directory tree (failed files in red). Right pane = metadata + full source code in `<pre>`.

### Screen 6 — Function / Method Explorer

**Fetches:** `/projects/{id}/symbols`, `/projects/{id}/files`, then on selection: `/symbols/{id}`, `/files/{file_id}`.

**Shows:** Left = filter input + list grouped by file. Right = docstring, params as chips, source snippet.

### Screen 7 — Class Explorer

**Same pattern as Function Explorer** but filtered to `symbol_type === 'class'`. Right pane also shows inheritance (from `classDetails.bases`) and list of methods (from `parent_id` matching).

### Screen 8 — Dependency Graphs

**Fetches:** `/stats` for metrics; `/dependencies/files` and `/dependencies/functions` lazily.

**Shows:** Metrics badges, React Flow canvas (draggable nodes with arrows), node detail popup on click, expandable unresolved references panel.

### Screen 9 — Statistics

**Fetches:** `/stats`, `/files`, `/symbols` in parallel.

**Shows:** Project Overview card, Parsing Health with progress bar + failed file list, Repository Size with largest files, Symbol Breakdown with type proportions, File Dependencies metrics, Function Call metrics.

---

## 18. Update / Re-index Flow

### Why Updates Are Needed

After indexing version 1, you add new features. The old index is stale. You upload a new ZIP to re-analyze.

### How the User Updates

The "Update Project (ZIP)" button in the sidebar (`AppShell.jsx`) opens a file picker. On selection:

1. `POST /projects/{overview.id}/update-upload` with new ZIP
2. Backend: looks up project name → calls `_extract_and_index_zip(..., update_project_id=project_id)`
3. Indexer: `UPDATE projects SET root_path=?, indexed_at=NOW WHERE id=?` → wipe child tables → rebuild
4. Returns same `project_id`
5. Frontend: `GET /projects/{id}` → update `overview` state → all screens refresh

### Why Project ID Must Stay Stable

The `overview.id` is embedded in every API call the frontend makes. If the ID changed, all subsequent calls would return 404. The current implementation correctly preserves the ID by updating the project row in place.

### The Bug: Original Implementation Created a New Project ID

The first update implementation called `_extract_and_index_zip` without `update_project_id`, so the indexer took the normal path: delete by name → insert new row → new ID returned. The frontend's `onUpdateOverview` would update the `overview.id` to the new value, which worked, but the ID was not stable. The fix was to pass `update_project_id=project_id` explicitly.

---

## 19. Error Handling

| Error scenario | How handled |
|---------------|------------|
| Invalid ZIP extension | Client-side: `setError('Please select a .zip file.')` before upload. Server-side: HTTP 400. |
| Malformed ZIP (not real ZIP) | `zipfile.is_zipfile()` → HTTP 400 "not a valid ZIP archive" |
| Zip Slip | realpath check → HTTP 400 "Zip Slip" |
| Project not found | `SELECT id FROM projects WHERE id=?` → HTTP 404 |
| Empty search query | FastAPI `Query(..., min_length=1)` → HTTP 422. Also internal guard: `if not query_str: return []` |
| Syntax error in file | `parse_file()` catches `SyntaxError`, stores `parse_ok=False`, continues with other files |
| Backend failure | Frontend `try/catch` around all `fetch()` calls, shows error alert |
| Empty graph | `DependencyGraphs.jsx`: `nodes.length === 0` → shows "No graph data available" |
| No classes/functions | Explorer components: `groupedFilteredSymbols.length === 0` → shows "No X match" |
| No search results | `results.length === 0` → shows `No results found for "..."` |

---

## 20. Testing

### What Automated Testing Is

Writing code that verifies other code works correctly. Run once, get a pass/fail report in seconds, instead of manually testing every feature after each change.

### What pytest Is

Discovers all `def test_*` functions in `test_*.py` files, runs them, reports results. Run with: `cd backend && python -m pytest tests/`

### Unit vs Integration Testing

- **Unit:** Tests one isolated function (e.g., `parse_file()` alone)
- **Integration:** Tests multiple components together (e.g., full upload endpoint → ZIP extraction → indexing → database verification)

CodeSeek has both types.

### Test Areas

| File | Count | What it tests |
|------|-------|---------------|
| `test_scanner.py` | 6 | Python file detection, relative paths, ignored dirs, total count |
| `test_parser.py` | 20+ | Functions, methods, classes, async, nested, imports, calls, inheritance, syntax errors, symbol IDs, determinism |
| `test_indexer.py` | 3 | Database storage counts, re-indexing without duplication, syntax-error storage |
| `test_search.py` | 10 | All scoring tiers, case insensitivity, empty query, limit, tie-breaking determinism |
| `test_graphs.py` | 2 | File graph structure + edges, call graph resolution, unresolved list |
| `test_api.py` | 12 | All major API endpoints via FastAPI `TestClient` |
| `test_upload.py` | 8 | Valid ZIP, wrapper folder, non-ZIP rejection, malformed ZIP, Zip Slip, missing name field, update flow, 404 on missing project |

**Verified test function count:** At least 61 `def test_` functions across all 7 test files (counted from source). The exact total when run may differ slightly due to test discovery settings.

---

## 21. Git and GitHub

### Key Terms

| Term | Meaning |
|------|---------|
| **Repository** | A folder tracked by Git |
| **Commit** | A saved snapshot of changes with a message |
| **Branch** | A parallel line of development (`main` is default) |
| **Push** | Sending local commits to GitHub |
| **Pull** | Downloading commits from GitHub |
| **Clone** | Downloading a repository from GitHub for the first time |

### What Should NOT Be Committed

| Item | Why excluded |
|------|-------------|
| `backend/uploads/` | Contains user-uploaded project files — private, large, not part of CodeSeek itself |
| `backend/codeseek.db` | Developer's local index data — would conflict between machines, may contain private code |
| `__pycache__/` | Auto-generated bytecode — machine-specific, causes conflicts |
| `*.pyc` | Same as above |

The root `.gitignore` file covers `backend/uploads/` and `backend/codeseek.db`. Note: the `codeseek.db` and `test3.db` files visible in the repository root are not currently excluded by `.gitignore` — a gap in the current configuration.

---

## 22. Real Problems Encountered During Development

### Problem 1 — Python Environment Setup

Running `python` might invoke Python 2, or the wrong version. `pip install` might install to the global environment.

**Fix:** Always use a virtual environment. The `.venv` folder is in `IGNORED_DIRS` so the scanner skips it.

**Lesson:** Virtual environments isolate dependencies per project. Always activate before running.

### Problem 2 — npm PowerShell Execution Policy (Windows)

npm scripts failed on Windows PowerShell with "execution of scripts is disabled on this system."

**Fix:** Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` once, or use Command Prompt.

**Lesson:** Windows restricts script execution by default. Common first-time pain point.

### Problem 3 — `GET /projects/{id}` Returning 404 By Design

The API correctly returns 404 before any project exists. A developer might think the API is broken.

**Explanation:** 404 is the correct, intended behavior. The API looked up the ID, found nothing, and correctly reported "not found." It is not a bug.

**Lesson:** 404 is a valid API response for non-existent resources.

### Problem 4 — UI Initially Too Narrow on Large Monitor

The home page uses `max-width: 600px`, which looks narrow on a wide monitor.

**Explanation:** Intentional for a form-focused upload screen. The post-upload screens use full width.

**Lesson:** Different screens need different appropriate widths.

### Problem 5 — Blank React Flow Canvas

The Dependency Graphs screen loaded, the mini-map showed dots, but the main canvas was completely blank.

**Root causes:**
1. React Flow requires explicit pixel dimensions on its container. Without `minHeight: 0` on the flex child, React Flow has zero height.
2. The node-ID mismatch bug (file graph IDs vs edge source/target values).

**Fixes:** Added `minHeight: 0` on the flex child. Fixed ID mismatch with `idKey='label'` for file graphs.

**Lesson:** React Flow is sensitive to container sizing. When canvas looks blank: check container dimensions AND verify node IDs match edge endpoint values.

### Problem 6 — Graph Node-ID Mismatch

(See Section 15 for full explanation.) Nodes and edges referenced different ID schemes, causing React Flow to silently fail to draw any edges.

**Lesson:** In graph visualization, node IDs and edge source/target values must be identical strings.

### Problem 7 — Statistics `overview.counts` Bug

Accessing `overview.counts.files` when `counts` was undefined threw a TypeError.

**Fix:** Optional chaining everywhere: `overview.counts?.files`.

**Lesson:** Always use defensive programming (`?.`) when reading API responses. Responses can change, and JavaScript does not protect against undefined property access automatically.

### Problem 8 — Update Flow Creating a New Project ID

The original update flow created a new project row each time, changing the ID. This broke the ID-based API calls.

**Fix:** Pass `update_project_id` to the indexer so it updates the existing row in place.

**Lesson:** Re-indexing must preserve the project identity. Use UPDATE instead of DELETE+INSERT.

### Problem 9 — Local Database and Uploads Appearing in Git Status

After running the app locally, `codeseek.db` and `backend/uploads/` appeared as untracked changes.

**Fix:** Ensure these are in `.gitignore`. The current `.gitignore` covers `backend/codeseek.db` and `backend/uploads/`.

**Lesson:** Add generated files to `.gitignore` immediately. Do not commit database files or user-uploaded content.

---

## 23. Security Considerations

### CodeSeek Does Not Execute Repository Code

`ast.parse()` converts source text to a tree without evaluating it. No `exec()`, no `eval()`, no subprocess calls on user code. A script containing `os.system("rm -rf /")` would have its imports and calls recorded, but the command would never run.

### Static Analysis Reduces Execution Risk

The code is read, not run. Even malicious code cannot execute through CodeSeek's analysis pipeline.

### Zip Slip Prevention

Every ZIP entry is checked against the extraction directory with `os.path.realpath()` before extraction. Path traversal entries are rejected.

### Upload Validation

Both client-side (React) and server-side (FastAPI) require `.zip` extension. Server-side also validates with `zipfile.is_zipfile()`.

### Local-Only MVP Limitations

CodeSeek has **no authentication**. Anyone who can reach port 8000 can use the API. This is acceptable for a local development tool but would require authentication, HTTPS, and rate limiting before any public deployment.

---

## 24. Current Limitations

Based on `KNOWN_LIMITATIONS.md` and the actual implementation:

| Limitation | Details |
|-----------|---------|
| **Python Only** | Scanner and parser work exclusively with `.py` files |
| **Static Analysis Only** | Dynamic runtime behavior not tracked |
| **Incomplete Call Resolution** | Ambiguous/dynamic calls and built-ins remain unresolved |
| **Persistent Extracted Uploads** | `backend/uploads/` grows indefinitely; manual cleanup required |
| **SQLite Scale Limit** | Not optimized for massive monorepos or concurrent multi-user access |
| **No Semantic AI Search** | Keyword-based only; cannot answer intent-based queries |
| **No GitHub Integration** | Manual ZIP upload only |
| **No Incremental Indexing** | Full wipe-and-rebuild on every update |
| **No Authentication or Cloud** | Single-user local tool only |

---

## 25. Why This Architecture Was Chosen

### Why Python-Only MVP?

Python's `ast` module is built in — no external parser. Consistent with the backend language. Sufficient for a college MVP scope.

### Why Built-in `ast`?

Maintained by the Python core team. Handles every valid Python 3 construct. Available on any Python 3 installation. No external dependencies.

### Why SQLite Instead of PostgreSQL?

Zero configuration. Single file. Python built-in. Perfect for single-user local tool. PostgreSQL is designed for multi-user high-concurrency — massive overkill for this MVP.

### Why FastAPI?

Auto-generates interactive `/docs`. Validates input automatically. Native multipart support. Faster than Flask. Lighter than Django for a pure API.

### Why React?

Most widely adopted JavaScript UI library. Natural component model matches CodeSeek's screen structure. `@xyflow/react` requires React.

### Why NetworkX?

Standard Python graph library. Computes in-degree, out-degree, top nodes without custom code. Natural fit for backend graph analysis.

### Why Full Re-index?

Incremental indexing requires detecting file changes, cascading impact analysis, careful partial database updates — significantly more complex and error-prone. Full re-index is simple, consistent, and correct.

---

## 26. End-to-End Request Traces

### Trace A: Uploading a Project

1. User types "sample_shop", selects ZIP, clicks Analyze Project
2. `App.jsx`: builds FormData → `POST /projects/analyze-upload`
3. Backend: extension check → `zipfile.is_zipfile()` → Zip Slip check
4. Extract to `uploads/<uuid>/` → detect wrapper folder
5. `index_project("sample_shop", analyze_dir)`
6. `init_db()` → `scan_repository()` → `parse_repository()`
7. INSERT: projects → files → symbols → imports → calls
8. Return `{"project_id": 1}`
9. `App.jsx`: `GET /projects/1` → set `overview` → `activeTab = 'dashboard'`

### Trace B: Searching for a Function

1. User types "validate_email", clicks Search
2. `Search.jsx`: `GET /projects/1/search?q=validate_email`
3. `search.py`: lowercase → query calls/imports/symbols/files tables
4. Score: exact symbol match → +100; caller `AuthService.login_user` → +15
5. Sort by -score. Return array
6. `Search.jsx`: render result cards

### Trace C: Opening a Source File

1. User clicks "services/auth.py" in File Explorer tree
2. `FileExplorer.jsx`: `setSelectedFile(file)` → `useEffect` triggers
3. `GET /files/3` (file_id=3)
4. Backend: `SELECT * FROM files WHERE id=3` → return full row including `source`
5. Frontend: render source in `<pre><code>`

### Trace D: Viewing a Dependency Graph

1. User clicks Graphs in sidebar
2. `DependencyGraphs.jsx` mounts. `useEffect` triggers for `graphType='files'`
3. `GET /projects/1/stats` (for metrics)
4. `GET /projects/1/dependencies/files`
5. `graphs.py`: read files table → read imports table → build `nx.DiGraph` → serialize to JSON
6. `DependencyGraphs.jsx`: `toFlowNodes(nodes, 'label', 'label')` + `toFlowEdges(edges)`
7. `computeGridPositions()` assigns x,y
8. React Flow renders interactive canvas

### Trace E: Updating a Project

1. User clicks "Update Project (ZIP)", selects new ZIP
2. `AppShell.jsx`: `POST /projects/1/update-upload` with new file
3. Backend: lookup project name → `_extract_and_index_zip("sample_shop", file, update_project_id=1)`
4. Extract new ZIP → `index_project(..., update_project_id=1)`
5. `UPDATE projects SET root_path=?, indexed_at=NOW WHERE id=1`
6. DELETE calls → imports → symbols → files for project 1
7. INSERT new data. Return `{"project_id": 1}` (same ID)
8. `AppShell.jsx`: `GET /projects/1` → `onUpdateOverview(updatedOverview)` → all screens refresh

---

## 27. Demo Preparation

### 30-Second Project Introduction

"CodeSeek is a code intelligence tool for Python projects. You give it a ZIP file, it analyzes the code without running it, and gives you a searchable web interface to explore functions, classes, dependencies, and call relationships. It is like having an instant map of any Python codebase."

### 1-Minute Introduction

"When you receive a new Python project, understanding its structure can take hours. CodeSeek solves this by applying static analysis — reading the code's structure without executing it. You upload a ZIP, CodeSeek parses every Python file using Python's own AST module, extracts every function, method, class, import, and call, stores it all in a local SQLite database, and gives you a web interface. You can search for anything, browse files with source code, explore class hierarchies, and visualize how files and functions connect. Everything is local, nothing runs your code, and the analysis takes seconds."

### 3-Minute Demo Script

| Time | Action | What to say |
|------|--------|-------------|
| 0:00 | Show home screen | "This is CodeSeek's upload screen." |
| 0:15 | Select ZIP, type name, click Analyze | "The backend extracts the ZIP, scans Python files, parses each file's AST, stores everything in SQLite." |
| 0:30 | Dashboard appears | "Dashboard: 6 files, all parsed OK, functions, methods, classes at a glance." |
| 0:45 | Click Search, type "validate_email" | "Searching for a function — exact match scores 100, appears instantly with file and line numbers." |
| 1:00 | Click File Explorer → select auth.py | "File Explorer shows the project tree. Clicking any file shows full source code." |
| 1:30 | Click Functions → select login_user | "Function Explorer shows docstring, parameters, and a source snippet." |
| 2:00 | Click Classes → select User | "Class Explorer shows inheritance (User inherits from BaseUser) and all methods." |
| 2:20 | Click Graphs → File Dependencies | "File dependency graph: app.py depends on services/auth.py and payment.py." |
| 2:40 | Switch to Function Calls graph | "Call graph: which functions call which. Unresolved calls appear below — static analysis limitation." |
| 2:55 | Show Statistics | "Statistics: total lines, largest files, most-called functions." |
| 3:00 | Close | "That's CodeSeek — local, fast, no execution required." |

### What NOT to Claim

- Do not claim CodeSeek detects bugs
- Do not claim it supports languages other than Python
- Do not claim the call graph is 100% complete
- Do not claim production-level security
- Do not claim enterprise-scale performance

---

## 28. Viva Preparation — 75+ Questions

### Beginner Web Concepts

**Q1. What is the difference between frontend and backend?**
Frontend: everything the user sees, runs in the browser. Backend: server-side program that processes data, runs code, stores information.

**Q2. What is localhost?**
A hostname always referring to the current machine (127.0.0.1). Both servers run on localhost: frontend at port 5173, backend at port 8000.

**Q3. Why do we need two servers?**
Frontend (Vite/React) serves HTML/JavaScript. Backend (FastAPI/Uvicorn) handles data processing. They serve different purposes in different environments.

**Q4. What is port 5173?**
Vite's default development server port. A port is a numbered endpoint — processes listen on specific ports for incoming connections.

**Q5. What is CORS and why is it configured in CodeSeek?**
Cross-Origin Resource Sharing. A browser security feature blocking JavaScript from calling URLs on different origins (different port = different origin). FastAPI's `CORSMiddleware` allows port 5173 to call port 8000.

**Q6. What is JSON?**
JavaScript Object Notation. A text format for structured data that both Python and JavaScript understand natively.

**Q7. What is the difference between GET and POST?**
GET retrieves data (search, fetch files). POST sends data to trigger an action (upload ZIP, update project).

**Q8. What does HTTP 404 mean?**
Resource not found. In CodeSeek: accessing a non-existent project ID returns 404.

**Q9. What does HTTP 422 mean?**
Unprocessable Entity — request is syntactically valid but fails semantic validation. FastAPI returns 422 for empty search queries (min_length=1 constraint).

### FastAPI / API

**Q10. What is FastAPI?**
A modern Python web framework for building APIs. Uses type hints for auto-validation and generates interactive docs at `/docs`.

**Q11. What is Uvicorn?**
An ASGI server that runs the FastAPI application and listens for HTTP connections on port 8000.

**Q12. What is the `{symbol_id:path}` path converter?**
A FastAPI feature allowing slashes in a path parameter. Normal `{symbol_id}` stops at `/`, but symbol IDs contain slashes (e.g., `services/auth.py::AuthService`).

**Q13. How does CodeSeek handle file uploads?**
`multipart/form-data` encoding. FastAPI's `UploadFile = File(...)` reads the file. React's `FormData` packages it.

**Q14. What is UploadFile?**
FastAPI's type for an uploaded file received via multipart form data. Provides `.filename` and `.file.read()`.

**Q15. What is Swagger UI?**
Auto-generated interactive API docs at `/docs`. Test every endpoint in the browser without writing code.

**Q16. List all CodeSeek API endpoints and their methods.**
(See the table in Section 5.)

**Q17. What status code does an empty search query return?**
422 — FastAPI's `Query(..., min_length=1)` rejects it automatically.

**Q18. What is `python-multipart`?**
A Python library required by FastAPI to parse multipart form data (file uploads). Listed in `requirements.txt`.

### React

**Q19. What is React?**
A JavaScript library for building UIs from reusable components.

**Q20. What is state in React?**
Data owned by a component. When changed via `useState`'s setter, the component re-renders.

**Q21. What is `useEffect` used for?**
Performing side effects (API fetching) after rendering. Re-runs when listed dependencies change.

**Q22. What is props?**
Data passed from parent to child component. `overview` is a prop in CodeSeek passed to all screens.

**Q23. What does `overview.counts?.files` mean?**
Optional chaining. If `counts` is undefined, returns `undefined` instead of throwing a TypeError.

**Q24. What is Vite?**
A fast JavaScript build tool and development server. Serves the React app at port 5173.

**Q25. How does the File Explorer build its tree?**
Splits each file's `relative_path` on `/` and builds a nested JavaScript object of folders and files.

**Q26. Why is `Promise.all` used in Statistics?**
To fetch three endpoints in parallel simultaneously instead of sequentially, reducing total load time.

**Q27. What does the `key` prop do in React lists?**
Helps React identify which items changed when re-rendering a list. Should be stable and unique.

### AST / Parser

**Q28. What is AST?**
Abstract Syntax Tree. A tree representation of source code's grammatical structure. `ast.parse()` produces it.

**Q29. Why use `ast` instead of regex for parsing?**
Regex cannot understand nesting or context. The AST knows the exact position of every token in the code structure.

**Q30. How does CodeSeek distinguish a method from a function?**
Scope stack in `_CodeVisitor`. If the immediate parent scope when entering a `FunctionDef` is a class scope → method. If function scope → nested function. If empty → standalone function.

**Q31. What AST node types does CodeSeek use?**
`FunctionDef`, `AsyncFunctionDef`, `ClassDef`, `Import`, `ImportFrom`, `Call`.

**Q32. What is a deterministic symbol ID?**
A unique text ID computed from file path and qualified name. Always produces the same value. Example: `services/auth.py::AuthService.login_user`.

**Q33. Why `::` in symbol IDs?**
Conventional separator between file path part and qualified name part. Visually distinguishes file from name.

**Q34. What happens when a file has a syntax error?**
`parse_file()` catches `SyntaxError`, returns `parse_ok=False` with error message. Other files continue normally.

**Q35. What is `ast.get_docstring(node)`?**
Returns the first string literal in a function/class body as the docstring, or `None`.

**Q36. What is the scope stack?**
A list of `{kind, name, symbol_id}` dicts maintained by `_CodeVisitor` tracking current nesting context (class/function scopes).

**Q37. How are `*args` and `**kwargs` captured?**
`_get_param_names()` checks `args_node.vararg` (for `*args`) and `args_node.kwarg` (for `**kwargs`) and appends them with `*` and `**` prefixes.

### Database / Indexer

**Q38. What database does CodeSeek use?**
SQLite. A file-based relational database stored in `codeseek.db`.

**Q39. What are the five tables?**
`projects`, `files`, `symbols`, `imports`, `calls`.

**Q40. What is a foreign key?**
A column referencing the primary key of another table. `files.project_id` references `projects.id`.

**Q41. What is cascade delete?**
When a parent row is deleted, all child rows linked by foreign key are automatically deleted.

**Q42. Why does `parameters` use JSON format in the database?**
SQLite has no array data type. JSON encodes a Python list as a text string. Read back with `json.loads()`.

**Q43. What is `PRAGMA foreign_keys = ON`?**
Enables foreign key constraint enforcement in SQLite. Without it, SQLite ignores foreign keys by default.

**Q44. What does `init_db()` do?**
Creates all five tables if they do not already exist. Called at the start of every `index_project()` call.

**Q45. What is `conn.row_factory = sqlite3.Row`?**
Makes SQLite return dict-like row objects that can be accessed by column name: `row["name"]` instead of `row[0]`.

### Search

**Q46. What is the exact symbol name match score?**
+100. It is the highest score, meaning exact matches always rank above everything else.

**Q47. List all search score weights from highest to lowest.**
+100 exact name, +80 prefix, +60 substring, +40 filename/path, +30 parameter, +20 docstring, +15 import/call, +5 raw source.

**Q48. How does case-insensitive search work?**
SQL `LOWER()` on both stored values and query. Python `.lower()` on the query string.

**Q49. What is the default search result limit?**
50 results (the `limit` parameter in `search_project`, default=50).

**Q50. How are ties broken?**
By result ID string, alphabetically. Ensures deterministic ordering across repeated identical queries.

**Q51. What is the `like_query` variable?**
`f"%{query_lower}%"` — used with SQL `LIKE` for substring matching. `%` is SQL wildcard for any characters.

### Graphs

**Q52. What is a directed graph?**
A graph where edges have a direction (arrows). `A → B` differs from `B → A`.

**Q53. What is in-degree?**
Number of edges pointing INTO a node. High in-degree file = imported by many others.

**Q54. What are "unresolved" items in graphs?**
Imports/calls that could not be matched to an internal project symbol (external libraries, ambiguous calls).

**Q55. How does call resolution work?**
Takes last part of dotted name, looks up in symbol names map. If exactly one match → create edge. Otherwise → unresolved.

**Q56. Why is call resolution imperfect for Python?**
Python is dynamically typed. The type of `obj` in `obj.process()` is not known without execution.

**Q57. What is `nx.DiGraph()`?**
Creates a directed graph object. `add_node()` adds nodes with metadata. `add_edge()` adds directed edges.

**Q58. Why does the file graph use `idKey='label'`?**
Because file graph edges reference file paths as source/target, but the backend's node `id` field contains `"file_1"` style IDs. Using `label` (which contains the file path) as the React Flow node ID ensures edges and nodes share the same identifier.

### ZIP / Security

**Q59. What is Zip Slip?**
A path traversal attack: ZIP entries contain `../` sequences to overwrite files outside the extraction directory.

**Q60. How does CodeSeek prevent Zip Slip?**
`os.path.realpath()` resolves all `../` sequences in member paths. If the resolved path does not start with the extraction directory, the ZIP is rejected.

**Q61. Why UUID for extraction directories?**
To avoid collisions between simultaneous uploads and isolate each project's files.

**Q62. Why are extracted folders not deleted after indexing?**
The File Explorer reads source code on demand from the extracted files. Deleting them would break source viewing.

**Q63. What happens if you upload a renamed .tar.gz as .zip?**
`zipfile.is_zipfile()` returns False → HTTP 400 "not a valid ZIP archive".

### Testing / Git

**Q64. What testing framework does CodeSeek use?**
pytest. All test files are in `backend/tests/`.

**Q65. How are tests run?**
`cd backend && python -m pytest tests/`

**Q66. What is `TestClient` in `test_api.py`?**
FastAPI's built-in test client that simulates HTTP requests without a running server.

**Q67. What is `.gitignore`?**
A file listing patterns for files/folders Git should not track. Prevents committing generated/private files.

**Q68. Why should `codeseek.db` not be committed?**
Contains developer-specific indexed data. Different developers → different content → merge conflicts. Should be auto-generated fresh on each machine.

**Q69. What does `git commit` do?**
Saves a snapshot of current changes to the local repository with a descriptive message.

**Q70. Why is `__pycache__/` excluded from Git?**
Auto-generated Python bytecode. Machine-specific. Changes every time code runs. Causes conflicts between machines.

### Architecture / Design Decisions

**Q71. Why FastAPI over Flask?**
Auto-validates input, generates `/docs`, has built-in multipart support, faster than Flask for I/O-bound work.

**Q72. Why is the analysis pipeline synchronous?**
Simplicity for MVP. Backend analyzes and stores everything before responding. For large projects, background task processing could be added.

**Q73. Why does the frontend hardcode `http://127.0.0.1:8000`?**
Local MVP has no configuration management. Production deployment would use environment variables or a reverse proxy.

**Q74. What is the role of `database/core.py`?**
Provides `get_connection()` (opens SQLite with foreign key enforcement + dict-like rows) and `init_db()` (creates tables).

**Q75. Why is source code stored in the database?**
The `source` column enables raw source code search (the +5 score tier). Source is also read from the extracted files on disk for the File Explorer view.

### Limitations / Future Scope

**Q76. How would you add JavaScript support?**
Integrate a JavaScript parser (tree-sitter). Modify scanner for `.js`/`.ts`. Create a separate parser module. Adjust schema for language field.

**Q77. How would incremental indexing work?**
Compare file checksums between versions. Delete and re-parse only changed files. Much more complex due to cascading symbol/call graph impacts.

**Q78. How would you add semantic search?**
Embed code/docstrings with a language model. Store vectors in a vector database (Chroma, pgvector). Search becomes vector similarity lookup.

**Q79. What security additions would be needed for production?**
HTTPS, user authentication/authorization, rate limiting, upload size limits, sanitized error messages, CORS restricted to actual domain.

**Q80. What is the largest CodeSeek can handle practically?**
Not formally benchmarked, but SQLite handles thousands of symbols easily. For projects with 100+ files and 10,000+ symbols, performance should still be acceptable. Very large monorepos (millions of lines) would require database migration and incremental indexing.

---

## 29. Glossary

| Term | Definition |
|------|-----------|
| **API** | Application Programming Interface. A defined set of endpoints for programs to communicate. |
| **AST** | Abstract Syntax Tree. A tree representation of source code's grammatical structure. |
| **async function** | A function defined with `async def`. Recorded with type `async_function` or `async_method`. |
| **backend** | Server-side program handling data processing, analysis, and storage. In CodeSeek: FastAPI/Uvicorn. |
| **cascade delete** | Deleting a parent database row automatically deletes all linked child rows. |
| **client** | The program making requests to a server. In CodeSeek: the browser running React. |
| **component** | A reusable piece of UI in React, written as a JavaScript function returning JSX. |
| **CORS** | Cross-Origin Resource Sharing. Browser security mechanism controlling which origins can call a server. |
| **deterministic ID** | An identifier computed algorithmically from known data, always producing the same result. |
| **directed graph** | A graph where edges have a direction (arrows from source to target). |
| **edge** | A connection between two nodes in a graph. Import relationship or function call in CodeSeek. |
| **endpoint** | A specific URL + HTTP method combination exposed by the API. |
| **FastAPI** | Modern Python web framework for building APIs with auto-validation and doc generation. |
| **foreign key** | A database column referencing the primary key of another table. |
| **FormData** | Browser API for packaging file uploads and form fields into `multipart/form-data`. |
| **frontend** | Everything the user sees in the browser. In CodeSeek: the React application. |
| **GET** | HTTP method for retrieving data without side effects. |
| **graph** | Mathematical structure of nodes (points) and edges (connections). |
| **HTTP** | HyperText Transfer Protocol. Communication protocol between browsers and servers. |
| **in-degree** | Number of edges pointing into a node. High in-degree = many others depend on this node. |
| **indexer** | The module (`indexer.py`) orchestrating scan + parse + database storage. |
| **JSON** | JavaScript Object Notation. Text format for structured data. |
| **localhost** | Hostname always referring to the current machine. Same as 127.0.0.1. |
| **method** | A function defined inside a class. Types: `method` or `async_method`. |
| **multipart upload** | HTTP encoding allowing both binary file data and text fields in one request body. |
| **NetworkX** | Python library for creating and analyzing graph structures. |
| **nested function** | A function defined inside another function. Type: `nested_function`. |
| **node** | A point in a graph. File node in file graph; function node in call graph. |
| **npm** | Node Package Manager. Installs JavaScript libraries like React and Vite. |
| **out-degree** | Number of edges going out from a node. High out-degree = imports many others. |
| **parser** | The module (`parser.py`) that reads Python source with `ast.parse()` and extracts metadata. |
| **port** | A numbered network endpoint. Processes listen on specific ports. CodeSeek: 5173 (frontend), 8000 (backend). |
| **POST** | HTTP method for sending data or triggering an action with side effects. |
| **primary key** | Column uniquely identifying each row. CodeSeek uses auto-increment `id`. |
| **props** | Properties passed from parent React component to child. |
| **React** | JavaScript library for building UIs from reusable components. |
| **React Flow** | The `@xyflow/react` library. Renders interactive node-edge diagrams in the browser. |
| **re-index** | Re-running the full analysis pipeline. In CodeSeek: wipe child data, rebuild from new ZIP. |
| **request** | A message from client to server asking for data or triggering an action. |
| **response** | A message from server to client containing data or a status report. |
| **scanner** | The module (`scanner.py`) that recursively finds all `.py` files in a directory. |
| **scope stack** | Internal data structure in `_CodeVisitor` tracking nesting context during AST traversal. |
| **server** | A program listening for requests and responding with data. In CodeSeek: FastAPI/Uvicorn. |
| **SQLite** | A file-based, zero-configuration relational database. The entire DB is a single `.db` file. |
| **state** | Data owned by a React component that triggers re-render when changed. |
| **static analysis** | Analyzing code by reading its structure without executing it. |
| **status code** | A three-digit number in HTTP responses: 2xx success, 4xx client error, 5xx server error. |
| **symbol** | A named structural element: function, method, nested function, or class. |
| **symbol_type** | The specific kind of symbol: `function`, `async_function`, `method`, `async_method`, `nested_function`, `class`. |
| **UploadFile** | FastAPI's type for an uploaded file from multipart form data. |
| **Uvicorn** | ASGI server that runs the FastAPI application and handles HTTP connections. |
| **virtual environment** | Isolated Python installation per project. Ignored by the CodeSeek scanner. |
| **Vite** | JavaScript build tool and development server. Serves the React app at port 5173. |
| **Zip Slip** | Path traversal attack using `../` in ZIP entry names to write files outside extraction directory. |
| **useEffect** | React hook for performing side effects (like API fetching) after rendering. |
| **useState** | React hook for adding reactive state to a functional component. |

---

## 30. Final Revision Sheets

### CodeSeek Architecture in 15 Lines

1. User uploads a Python project as ZIP via the React frontend.
2. Browser sends `POST /projects/analyze-upload` with `multipart/form-data`.
3. FastAPI backend validates: ZIP extension, `zipfile.is_zipfile()`, Zip Slip check.
4. ZIP extracted to `backend/uploads/<uuid>/` (retained for source viewing).
5. Wrapper-folder detection ensures correct project root.
6. `scanner.py` recursively finds all `.py` files, ignoring venv/cache/git folders.
7. `parser.py` reads each file, runs `ast.parse()`, extracts symbols/imports/calls.
8. `indexer.py` stores everything in SQLite: projects, files, symbols, imports, calls.
9. Backend returns `project_id`; frontend fetches overview, navigates to Dashboard.
10. Search: weighted SQL queries — exact match +100, prefix +80 ... raw source +5.
11. Graphs built by `graphs.py` using NetworkX DiGraph, serialized to `{nodes, edges, unresolved}`.
12. React Flow renders the interactive graph canvas from the JSON data.
13. File/Function/Class Explorers fetch data on demand from their respective endpoints.
14. Update flow preserves project ID by updating the projects row in place.
15. Everything runs locally; no code is executed; no external services needed.

---

### Tech Stack Cheat Sheet

| Technology | Port | Language | Role |
|-----------|------|---------|------|
| Vite (dev server) | 5173 | JavaScript | Serves the React app |
| React 19 | — | JavaScript | UI components |
| @xyflow/react | — | JavaScript | Graph canvas rendering |
| FastAPI | 8000 | Python | API framework |
| Uvicorn | 8000 | Python | ASGI HTTP server |
| Python `ast` | — | Python | Source code parsing |
| NetworkX | — | Python | Graph structure and metrics |
| SQLite | — | SQL | Persistent storage |
| pytest | — | Python | Automated testing |

---

### "What Happens When ZIP Is Uploaded?" Cheat Sheet

```
1. React: FormData {name, file} -> POST /projects/analyze-upload
2. Backend: .zip extension check -> zipfile.is_zipfile() -> Zip Slip check
3. Extract to backend/uploads/<uuid>/
4. Detect single wrapper folder, step into it if present
5. scan_repository() -> sorted list of .py relative paths
6. parse_repository() -> list of result dicts per file
7. INSERT into projects -> INSERT into files -> symbols -> imports -> calls
8. Return {project_id: N}
9. Frontend: GET /projects/N -> set overview -> navigate to Dashboard
```

---

### "What Happens When I Search?" Cheat Sheet

```
1. User types query -> React: GET /projects/{id}/search?q=...
2. search.py: lowercase query, build %query%
3. Query calls table: find callee name matches -> caller symbol IDs
4. Query imports table: find module/name matches -> file IDs
5. Query symbols table: name/param/docstring matches
6. Query files table: path/source matches
7. Score each result:
   exact name +100 | prefix +80 | substring +60 | path +40
   param +30 | docstring +20 | call/import +15 | source +5
8. Sort: -score first, then +id (tie-breaking)
9. Return top 50 results as JSON array
10. React renders result cards with name, type, path, line range, score, reasons
```

---

### Database Cheat Sheet

| Table | Key fields | Related to |
|-------|-----------|-----------|
| `projects` | id, name, root_path, indexed_at | Parent of all others |
| `files` | id, project_id, relative_path, line_count, source, parse_status | project |
| `symbols` | id, deterministic_id, project_id, file_id, name, symbol_type, start_line, end_line, parent_id, parameters (JSON), docstring, bases (JSON) | project, file |
| `imports` | id, project_id, file_id, module, imported_name, alias, line_number | project, file |
| `calls` | id, project_id, file_id, caller_symbol_id, raw_callee_name, line_number | project, file |

Symbol types: `function` | `async_function` | `method` | `async_method` | `nested_function` | `class`

---

### Graph Cheat Sheet

| Aspect | File Dependency Graph | Function Call Graph |
|--------|----------------------|---------------------|
| Node = | Python file | Function / Method |
| Edge = | Import statement | Call expression |
| Source data | `imports` table | `calls` table |
| NetworkX | `nx.DiGraph()` | `nx.DiGraph()` |
| Unresolved = | External library imports | Ambiguous / not-found calls |
| React Flow node ID | `label` (= rel_path) | `id` (= deterministic_id) |
| Edge source/target | rel_path strings | deterministic_id strings |

---

### Top 20 Viva Questions

1. What is CodeSeek and what problem does it solve?
2. What is an AST and why does CodeSeek use it instead of regex?
3. How does CodeSeek distinguish a function from a method?
4. What is a deterministic symbol ID? Give an example.
5. Explain the ZIP upload flow from user click to indexed project.
6. What is Zip Slip and how does CodeSeek prevent it?
7. What is CORS and why is it configured in the backend?
8. Explain the search scoring system with all weights.
9. What are the five tables in the database and what does each store?
10. What is the difference between the file dependency graph and the call graph?
11. Why does the file graph use `label` as the React Flow node ID?
12. What happens when a file has a syntax error?
13. How does the update flow preserve the project ID?
14. Why was SQLite chosen over PostgreSQL?
15. What is the role of NetworkX vs React Flow?
16. How is a call like `obj.process()` handled during graph building?
17. What is the purpose of the scope stack in the parser?
18. Why are extracted ZIP folders never deleted?
19. What is the `symbol_id:path` path converter in FastAPI used for?
20. List three current limitations of CodeSeek and how they could be addressed.

---

### Top 10 Limitations / Design Decisions

| # | Limitation/Decision | Reason |
|---|--------------------|-|
| 1 | Python-only | Built-in `ast` — no external parser needed |
| 2 | SQLite (not PostgreSQL) | Zero configuration, single file, Python built-in |
| 3 | Static analysis only | Safe (no code execution), simple, sufficient for MVP |
| 4 | Persistent uploads | Source code viewing requires files on disk |
| 5 | Full re-index (not incremental) | Simpler, consistent, no stale data risk |
| 6 | No semantic/AI search | Keeps system simple, no embedding infrastructure |
| 7 | No authentication | Local developer tool, not a multi-user system |
| 8 | No GitHub integration | Manual ZIP upload simpler for MVP |
| 9 | Incomplete call resolution | Dynamic typing makes static call resolution ambiguous |
| 10 | No production deployment | Local tool; production needs HTTPS, auth, rate limiting |

---

*End of CODESEEK_DETAILED_EXPLANATION.md*

---

> **Document statistics:**
> Sections: 30
> Repository files inspected: main.py, core.py, scanner.py, parser.py, indexer.py, search.py, graphs.py, App.jsx, AppShell.jsx, Dashboard.jsx, Search.jsx, FileExplorer.jsx, FunctionExplorer.jsx, ClassExplorer.jsx, DependencyGraphs.jsx, Statistics.jsx, index.css, package.json, vite.config.js, requirements.txt, test_scanner.py, test_parser.py, test_indexer.py, test_search.py, test_graphs.py, test_api.py, test_upload.py, PROJECT_CONTEXT.md, KNOWN_LIMITATIONS.md, .gitignore
> Total: 30 source files read
