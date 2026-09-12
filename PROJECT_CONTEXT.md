# CodeSeek — Project Context

## 1. Project Overview

**Project Name:** CodeSeek

**Current Version:** MVP v1

**Core Goal:**  
CodeSeek is a Python code-intelligence web application that scans a Python repository, parses source code using Python AST, builds a searchable structural index, stores metadata locally in SQLite, and allows users to search, explore, and understand files, functions, methods, classes, imports, calls, inheritance, and dependencies.

The project must remain simple, explainable, and suitable for a college mini-project demonstration.

---

## 2. MVP Scope

### Supported language
- Python only

### Repository input
- ZIP upload

### Parsing
- Python built-in `ast` module
- Static analysis only
- The application does NOT execute uploaded user code

### Storage
- SQLite

### Backend
- Python
- FastAPI

### Frontend
- React

### Dependency analysis
- NetworkX

### Dependency visualization
- React Flow or another lightweight React graph visualization library

### Re-indexing strategy
- Full re-indexing
- When the repository changes, the updated repository is uploaded again and analyzed again
- Incremental/live indexing is future scope

---

## 3. Features Included in MVP

CodeSeek v1 must support:

1. Upload Python project as ZIP
2. Extract repository
3. Recursively scan `.py` files
4. Ignore unsupported/non-code files and common generated folders
5. Parse each Python file using AST
6. Extract:
   - files
   - standalone functions
   - methods
   - classes
   - parameters
   - docstrings
   - imports
   - function/method calls
   - line numbers
   - inheritance relationships
   - source code snippets
7. Store structured metadata in SQLite
8. Build searchable index
9. Global search
10. Search filters:
   - All
   - Functions
   - Methods
   - Classes
   - Files
11. Ranked search results
12. File Explorer
13. Function/Method Explorer
14. Class Explorer
15. Source-code viewer
16. File dependency graph
17. Function-call graph
18. Repository statistics
19. Syntax-error handling
20. Full re-indexing

---

## 4. Features NOT Included in MVP

Do not add these unless explicitly requested later:

- Java support
- C/C++ support
- JavaScript support
- semantic AI search
- embeddings
- vector database
- bug detection
- code generation
- GitHub authentication
- GitHub repository import
- Chrome extension
- live filesystem watching
- incremental indexing
- runtime/dynamic analysis
- executing uploaded code
- user accounts
- cloud deployment

These may be added later as future scope.

---

## 5. Main User Flow

```text
Upload ZIP
   ↓
Extract repository
   ↓
Scan supported files
   ↓
Detect Python files
   ↓
Parse each file using AST
   ↓
Extract structural metadata
   ↓
Store metadata in SQLite
   ↓
Build CodeSeek search index
   ↓
Build dependency graphs
   ↓
Open dashboard
   ↓
Search / Browse / Explore code
```

---

## 6. UI Screens

### Screen 1 — Home / Upload
Must include:
- CodeSeek branding
- short tagline
- ZIP upload area
- selected ZIP name
- Analyze Project button
- Python support note
- short feature highlights

### Screen 2 — Analysis Progress
Show stages such as:
- repository extracted
- Python files detected
- files parsed
- functions found
- classes found
- imports found
- dependency graph built
- search index created

When complete:
- show summary
- Open Dashboard button

### Screen 3 — Dashboard / Overview
Sidebar:
- Overview
- Search
- Files
- Functions
- Classes
- Graphs
- Statistics

Overview cards:
- Files
- Functions
- Methods
- Classes
- Imports
- Function Calls
- Lines of Code

Also show:
- project name
- language
- last indexed time
- Re-index Repository button

### Screen 4 — Global Search
Search across:
- function names
- method names
- class names
- file names
- file paths
- parameters
- docstrings
- imports
- called functions
- source code

Filters:
- All
- Functions
- Methods
- Classes
- Files

Each result should show:
- symbol/file name
- type
- containing class if relevant
- file path
- line number/range
- docstring preview when available
- Open button

### Screen 5 — File Explorer
Show:
- repository tree
- file details
- classes
- functions/methods
- imports
- source-code button/view

### Screen 6 — Function Explorer
Show:
- function/method list
- type
- parent class if method
- parameters
- file path
- line range
- docstring
- functions called
- called-by relationships where resolvable
- source-code view

### Screen 7 — Class Explorer
Show:
- class list
- file
- line range
- parent classes
- methods
- docstring

### Screen 8 — Dependency Graphs
Two tabs:
1. File Dependencies
2. Function Calls

File graph:
- node = Python file
- edge = import dependency

Function graph:
- node = function/method
- edge = syntactic call relationship

### Screen 9 — Statistics
Show:
- number of files
- functions
- methods
- classes
- imports
- calls
- lines of code
- largest files
- most connected files

---

## 7. Indexing Strategy

CodeSeek uses **entity-based structural indexing**, not only raw-text indexing.

### File-level data
Index:
- filename
- relative path
- language
- line count
- source code
- parse status

### Symbol-level data
Index:
- functions
- methods
- classes

For every symbol store:
- name
- type
- file
- start line
- end line
- parent symbol/class when applicable
- parameters
- docstring
- code snippet

### Relationship-level data
Index:
- imports
- function/method calls
- inheritance

### Searchable metadata
Search may match:
- symbol names
- filenames
- paths
- parameters
- docstrings
- imports
- callees
- raw source text

---

## 8. Search Ranking Strategy

Results should be ranked approximately in this order:

1. Exact symbol-name match
2. Symbol name starts with query
3. Symbol name contains query
4. Exact/partial file-name or file-path match
5. Parameter match
6. Docstring match
7. Import/call match
8. Raw source-code match

Possible internal scores:

- Exact symbol: 100
- Prefix: 80
- Partial symbol: 60
- Filename/path: 50
- Parameter: 40
- Docstring: 35
- Import/call: 25
- Source code: 15

These values are implementation choices and may be adjusted, but stronger structural matches must rank above weak text matches.

---

## 9. Parsing Rules

Use Python built-in `ast`.

Important AST nodes:
- `FunctionDef`
- `AsyncFunctionDef`
- `ClassDef`
- `Import`
- `ImportFrom`
- `Call`

Also extract useful attributes such as:
- `name`
- `lineno`
- `end_lineno`
- arguments
- base classes
- decorators where useful

### Function vs Method
A `FunctionDef` at module level = function.

A `FunctionDef` inside a class = method.

### Nested functions
Index nested functions and retain parent relationship.

### Syntax errors
If one file fails parsing:
- mark file parse status as failed
- store error message/line if useful
- continue parsing all other files
- never fail the entire project because of one broken file

### Static-analysis limitation
CodeSeek analyzes source code without executing it.

Do not claim perfect runtime call resolution.

For calls like:
`obj.process()`

the exact runtime implementation may be ambiguous.

---

## 10. Database Schema

Use SQLite.

### `projects`

Fields:
- `project_id`
- `project_name`
- `uploaded_at`
- `total_files`
- `status`

### `files`

Fields:
- `file_id`
- `project_id`
- `filename`
- `relative_path`
- `language`
- `line_count`
- `source_code`
- `parse_status`
- optional parse error text

### `symbols`

Fields:
- `symbol_id`
- `file_id`
- `name`
- `type`
- `parent_symbol_id`
- `start_line`
- `end_line`
- `parameters`
- `docstring`
- `code_snippet`

Allowed main `type` values:
- `function`
- `method`
- `class`

### `imports`

Fields:
- `import_id`
- `file_id`
- `module_name`
- `imported_name`
- `alias`
- `line_number`

### `calls`

Fields:
- `call_id`
- `file_id`
- `caller_symbol_id`
- `callee_name`
- `line_number`

Inheritance can initially be stored as metadata for class symbols or in an additional relation if implementation needs it.

---

## 11. Dependency Logic

### File dependency graph
Derived primarily from imports.

Example:
```text
app.py → auth.py
auth.py → database.py
```

NetworkX representation:
- Node = file
- Edge = import dependency

### Function-call graph
Derived from AST `Call` nodes.

Example:
```text
login_user() → validate_email()
login_user() → get_user()
```

NetworkX representation:
- Node = function or method
- Edge = call relationship

Built-ins/external calls may be stored but can be visually de-emphasized or filtered.

---

## 12. Re-indexing

MVP uses full re-indexing.

Process:

```text
Updated ZIP uploaded
   ↓
Remove/replace old project index
   ↓
Extract repository again
   ↓
Scan all Python files
   ↓
Parse all files
   ↓
Rebuild database metadata
   ↓
Rebuild search index
   ↓
Rebuild dependency graphs
```

Incremental re-indexing is future scope.

---

## 13. Planned API Endpoints

These are conceptual and may be refined during implementation.

- `POST /projects/analyze`
- `GET /projects/{id}`
- `GET /projects/{id}/files`
- `GET /projects/{id}/symbols`
- `GET /projects/{id}/search?q=...`
- `GET /symbols/{id}`
- `GET /projects/{id}/dependencies/files`
- `GET /projects/{id}/dependencies/functions`
- `GET /projects/{id}/stats`
- `POST /projects/{id}/reindex`

---

## 14. Planned Folder Structure

```text
codeseek/
│
├── PROJECT_CONTEXT.md
├── README.md
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── database/
│   │   ├── models/
│   │   ├── services/
│   │   │   ├── scanner.py
│   │   │   ├── parser.py
│   │   │   ├── indexer.py
│   │   │   ├── search.py
│   │   │   └── dependencies.py
│   │   └── utils/
│   └── tests/
│
├── frontend/
│   └── React application
│
└── sample_projects/
    └── sample_shop/
```

Do not create unnecessary files or redesign this architecture without a clear reason.

---

## 15. Sample Development Repository

Use `sample_projects/sample_shop`.

Structure:

```text
sample_shop/
│
├── app.py
├── database.py
├── payment.py
├── services/
│   └── auth.py
├── models/
│   └── user.py
└── utils/
    └── validation.py
```

Expected high-level extraction:

- Python files: 6
- Classes: 4
- Standalone functions: 6
- Methods: 6

Important relationships:

```text
app.py
 ├──→ services/auth.py
 └──→ payment.py

services/auth.py
 ├──→ database.py
 └──→ utils/validation.py

payment.py
 ├──→ database.py
 └──→ utils/validation.py
```

Important function calls:

```text
start_application()
 ├──→ AuthService.login_user()
 └──→ process_payment()

AuthService.login_user()
 ├──→ validate_email()
 └──→ get_user()

process_payment()
 ├──→ validate_amount()
 └──→ save_payment()
```

Inheritance:

```text
User → BaseUser
```

Duplicate method names intentionally exist:

```text
BaseUser.display_name()
User.display_name()
```

This repository is the main correctness reference while developing CodeSeek.

---

## 16. Development Order

Build one module at a time.

### Phase 1 — Core analysis
1. Project setup
2. Repository scanner
3. AST parser
4. Test parser against `sample_shop`

### Phase 2 — Storage
5. SQLite setup
6. Database schema
7. Indexer
8. Store extracted data

### Phase 3 — Search
9. Basic search
10. Search ranking
11. Search filters

### Phase 4 — Dependency analysis
12. File dependency graph
13. Function-call graph
14. Statistics

### Phase 5 — API
15. FastAPI setup
16. Expose analysis/search/explorer/graph endpoints
17. Test endpoints

### Phase 6 — Frontend
18. React setup
19. Upload screen
20. Analysis screen
21. Dashboard
22. Search
23. Files
24. Functions
25. Classes
26. Graphs
27. Statistics

### Phase 7 — Integration and polish
28. Connect React and FastAPI
29. Re-indexing
30. Error handling
31. UI polish
32. Final testing
33. Demo preparation

Do not jump directly to later phases before the core parser/indexer works correctly.

---

## 17. Rules for AI Coding Agents

When using Claude, Antigravity, Cursor, Copilot, or another coding agent:

1. Read this entire file before modifying the project.
2. Inspect existing project files first.
3. Do not redesign architecture unless explicitly requested.
4. Work on only the requested development step.
5. Do not jump ahead and implement future modules.
6. Do not silently add unnecessary frameworks.
7. Do not replace technologies listed in this file without approval.
8. Keep code beginner-readable.
9. Add comments only where useful.
10. Explain new files and important logic after making changes.
11. Preserve working functionality.
12. Run or provide relevant tests for each completed module.
13. If an assumption is required, state it before making a major architectural change.
14. Never execute uploaded repository code; only statically analyze it.
15. Keep CodeSeek MVP Python-only unless explicitly told otherwise.

---

## 18. Handoff Template for a New AI Agent

When switching coding agents, use a message similar to:

> This is an existing CodeSeek project. First read `PROJECT_CONTEXT.md` completely and inspect the current repository before changing anything. Do not redesign the architecture or rewrite working modules. Determine which development phases are already complete from the code and Git history. Then summarize the current state to me. I will tell you which exact step to continue with.

Do not ask a new agent to “build CodeSeek” from scratch when code already exists.

---

## 19. Progress Reporting Template

After each coding session, maintain a short progress note containing:

### Completed
- What was implemented

### Files created/modified
- list files

### Tested
- commands/tests run
- result

### Current behavior
- what works now

### Known issues
- bugs or incomplete behavior

### Next step
- one clearly defined next task

This can be pasted back into ChatGPT along with relevant code/errors so project guidance remains synchronized.

---

## 20. Core Viva Explanation

If asked how CodeSeek works:

> CodeSeek first accepts a Python repository and recursively identifies Python source files. Each file is parsed using Python's AST module. From the AST, CodeSeek extracts structural metadata such as files, functions, methods, classes, parameters, docstrings, imports, line numbers, inheritance, and function calls. This structured information is indexed and stored locally in SQLite.

> When a user searches, CodeSeek queries this indexed metadata instead of blindly scanning every source file. Strong structural matches such as exact function or class names are ranked above weaker matches such as documentation or raw source-code text. Imports are used to construct the file dependency graph, while AST call expressions are used to construct the function-call graph. NetworkX manages these graph relationships, and the React frontend visualizes the results.

---

## 21. Project Principle

The project should prioritize:

**Working + Explainable + Testable**

over:

**Flashy + Overcomplicated + Difficult to Defend**

Every implemented feature should be understandable enough to explain during a viva.
