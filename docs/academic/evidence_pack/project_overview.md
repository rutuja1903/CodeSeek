# CodeSeek — Project Overview (Evidence Pack)

Computer Engineering Mini Project (PR1), SPIT, Academic Year 2026–27.

> **Audit basis.** Prepared on 2026-10-31 by inspecting the source in the working tree of
> `https://github.com/rutuja1903/CodeSeek.git`, branch `main`, HEAD `278f9d2`.
> The working tree also contains **uncommitted** changes (Milestone 8 stabilisation and an
> upload error-handling fix; see `git_and_team_evidence.md` §6). Line numbers in this pack
> refer to that working tree and may shift by a few lines relative to HEAD.

## Status labels used throughout this pack

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | Code exists in the repository and was read during this audit. |
| **VERIFIED** | Implemented *and* exercised by a test or a measurement run during this audit (output recorded). |
| **PARTIAL** | Exists but with significant documented restrictions. |
| **PLANNED** | Mentioned in planning documents only; no implementation. |
| **UNKNOWN** | No evidence available in the repository or audit. |

---

## 1. Problem addressed

Developers joining an unfamiliar Python codebase must work out where things are defined,
what calls what, which files depend on each other, and what a change will affect. Doing
this by reading files one at a time is slow. CodeSeek indexes a Python project once and
then answers these questions from a structured index, inside a browser, without executing
the project's code.

Source of this statement: module docstrings in `backend/app/main.py:1-6`,
`backend/app/services/parser.py:1-16`, `backend/app/services/analysis.py:1-20`, and the
planning documents `CodeSeek_Plan.md` and `PROJECT_CONTEXT.md` (committed in `ddaaaa4`).

## 2. Actual purpose and scope

- **Single-user, local** web application (backend binds to `127.0.0.1`; no authentication).
  — IMPLEMENTED, `backend/app/main.py:952-955`, `KNOWN_LIMITATIONS.md`.
- **Python-only** static analysis using the standard-library `ast` module.
  — IMPLEMENTED, `backend/app/services/scanner.py:34` (only `.py`),
  `backend/app/services/parser.py:422` (`parse_file`).
- Projects are supplied as **ZIP uploads** (or, through the API only, a local directory path).
  — IMPLEMENTED, `backend/app/main.py:250` (`/projects/analyze-upload`), `:64` (`/projects/analyze`).
- Uploaded code is **never executed**; it is only read and parsed.
  — IMPLEMENTED (no `exec`/`import` of uploaded code anywhere in `backend/app/`; parsing via `ast.parse`, `parser.py`).

## 3. Capabilities

| Capability | Status | Primary evidence |
|---|---|---|
| ZIP upload, safe extraction, indexing | VERIFIED | `main.py:147` `_extract_and_index_zip`; 25 tests in `tests/test_upload.py` |
| Update an existing project from a new ZIP | VERIFIED | `main.py:262`; `test_update_upload_existing_project` |
| AST extraction of classes, functions, methods, nested/async functions, imports, calls, parameters, docstrings, base classes | VERIFIED | `parser.py:165` `_CodeVisitor`; 19 tests in `tests/test_parser.py` |
| SQLite index (5 tables) | VERIFIED | `backend/app/database/core.py:19` `init_db`; `tests/test_indexer.py` |
| Weighted search over symbols, paths, parameters, docstrings, imports, calls, source | VERIFIED | `backend/app/services/search.py:10`; 11 tests in `tests/test_search.py` |
| File, Function and Class explorers with source navigation | IMPLEMENTED | `frontend/src/components/FileExplorer.jsx`, `FunctionExplorer.jsx`, `ClassExplorer.jsx` |
| File dependency graph and function call graph, cycle detection, graph metrics | VERIFIED | `backend/app/services/graphs.py:49,111,187,236`; `tests/test_graphs.py` |
| Interactive graph visualisation | IMPLEMENTED | `frontend/src/components/DependencyGraphs.jsx` (React Flow) |
| Statistics screen | IMPLEMENTED | `frontend/src/components/Statistics.jsx` |
| In-browser Python editor with syntax validation and atomic save + re-index | VERIFIED | `main.py:560` validate, `:627` save; 20 tests in `tests/test_editor.py` |
| Unsaved-change protection (tab/file switch and browser close) | IMPLEMENTED | `FileExplorer.jsx:125-135` (`beforeunload`), `App.jsx:39-61` |
| Diff of unsaved edits, per-hunk revert, Discard All | VERIFIED (diff logic) | `frontend/src/utils/lineDiff.js` (Myers diff); 14 tests in `lineDiff.test.js` |
| File version history (last 10 per file), preview, restore | VERIFIED | `backend/app/services/history.py`; 27 tests in `tests/test_history.py` |
| References, call hierarchy, symbol impact, file impact | VERIFIED | `backend/app/services/analysis.py:394,454,481,542`; `tests/test_analysis.py` |
| Potentially-unused function/class detection | VERIFIED | `analysis.py:665`; `test_potentially_unused_symbols` |

## 4. Technologies used

Versions are taken from the files named; "installed" versions were read from the local
virtual environment during the audit (`pip list`).

| Layer | Technology | Evidence |
|---|---|---|
| Backend language | Python 3.12.14 (installed in `backend/.venv`) | pytest header in audit run |
| Web framework | FastAPI 0.141.1, Starlette 1.6.0, Pydantic 2.13.5 | `backend/requirements.txt` (unpinned) + installed versions |
| ASGI server | Uvicorn 0.52.4 | same |
| Graph library | NetworkX 3.6.1 | same; used in `graphs.py` |
| Upload parsing | python-multipart 0.0.32 | same |
| Database | SQLite via Python `sqlite3` | `backend/app/database/core.py` |
| Testing (backend) | pytest 9.1.1, httpx 0.28.1 (FastAPI `TestClient`) | same |
| Frontend | React 19 (`^19.2.8`), React DOM | `frontend/package.json` |
| Graph UI | `@xyflow/react` (React Flow) `^12.11.6` | `frontend/package.json` |
| Build tool | Vite `^5.4.11`, `@vitejs/plugin-react` | `frontend/package.json` |
| Lint | oxlint `^1.81.0` | `frontend/package.json`, `frontend/.oxlintrc.json` |
| Frontend tests | Node.js built-in test runner (`node --test`) | `frontend/package.json` `"test"` script |

No AI/LLM, cloud service, Docker, external database or authentication provider is used.

## 5. Current limitations (summary)

Full list with evidence: `limitations_and_future_scope.md`.

- Python files only; other languages ignored.
- Static name-based resolution: ambiguous or dynamic calls stay unresolved or are labelled "ambiguous".
- Single-user, localhost only, no authentication.
- Uploading a project with an existing name replaces that project's index.
- Extracted uploads are never deleted automatically; there is no "delete project" feature.
- The editor is a plain textarea with a line gutter; it has **no syntax highlighting**.
