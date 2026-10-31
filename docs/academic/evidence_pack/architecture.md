# CodeSeek — Architecture (Evidence Pack)

> Line numbers refer to the working tree on 2026-10-31 (HEAD `278f9d2` plus uncommitted
> changes). Status labels are defined in `project_overview.md`.

## 1. Overall architecture — IMPLEMENTED

Three-tier local web application: a React single-page app talks to a FastAPI REST
backend over HTTP/JSON, and the backend stores its index in SQLite and snapshots on disk.

```
 Browser (http://localhost:5173)                 Backend (http://127.0.0.1:8000)
 ┌───────────────────────────────┐   HTTP/JSON   ┌──────────────────────────────────────┐
 │ React SPA (Vite dev server)   │ ────────────▶ │ FastAPI app  backend/app/main.py     │
 │  App.jsx  (upload + routing)  │  multipart    │  ├─ CORS middleware   (main.py:44)   │
 │  AppShell.jsx (sidebar/nav)   │ ◀──────────── │  ├─ upload/extract    (main.py:147)  │
 │  Dashboard / Search / Explor- │               │  ├─ editor endpoints  (main.py:560+) │
 │  ers / Graphs / Statistics /  │               │  ├─ history endpoints (main.py:807+) │
 │  CodeInsights / History / Diff│               │  └─ analysis endpoints(main.py:892+) │
 └───────────────────────────────┘               │ services/                            │
                                                 │  scanner → parser → indexer          │
                                                 │  search · graphs · analysis · history│
                                                 └──────┬──────────────────────┬────────┘
                                                        │ sqlite3              │ files
                                          codeseek.db (5 tables)    uploads/<uuid>/  (extracted projects)
                                                                    version_history/ (snapshots)
```

Deployment is two local processes (see `README.md`, uncommitted):
`uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app` (backend)
and `npm run dev` (frontend). Phase 2 deployment and component UML diagrams exist:
`deployment_diagram.png`, `component_diagram.png` (commit `bbef248`).

## 2. Frontend–backend communication — IMPLEMENTED

- **Transport:** browser `fetch()` to a hard-coded base URL `http://127.0.0.1:8000`
  (`frontend/src/components/analysisHooks.js:7`, `Dashboard.jsx:7`, `HistoryView.jsx:20`,
  and inline URLs in `App.jsx:113`, `FileExplorer.jsx:141-448`, etc.). There is no
  environment-variable configuration of the API URL.
- **Formats:** JSON for all endpoints; `multipart/form-data` for ZIP upload (`App.jsx:108-116`).
- **CORS:** only `http://localhost:3000`, `http://localhost:5173`, `http://127.0.0.1:5173`
  are allowed (`backend/app/main.py:44-50`). VERIFIED in this audit: a foreign origin
  received no `Access-Control-Allow-Origin` header; `localhost:5173` did.
- **Partial-success contract:** save/restore return HTTP **207** when the file was written
  but re-indexing failed (`main.py:696` `_reindex_after_write`). VERIFIED by
  `test_save_file_reindex_failure_returns_207_and_preserves_disk`.
- **Error display:** upload errors are converted to readable messages by
  `describeRequestError` / `errorDetail` (`frontend/src/utils/format.js:42-63`, uncommitted).

## 3. Major components and responsibilities

### Backend (`backend/app/`)

| Component | File | Responsibility |
|---|---|---|
| API layer | `main.py` | Routes, request validation (Pydantic), ZIP handling, path-safety checks, save/restore orchestration |
| Scanner | `services/scanner.py:34` `scan_repository` | Walk a directory, return sorted relative `.py` paths, skip `IGNORED_DIRS` (`:19`) |
| Parser | `services/parser.py:422` `parse_file`, `:513` `parse_repository`, `:165` `_CodeVisitor` | AST extraction of symbols, imports, calls |
| Indexer | `services/indexer.py:13` `index_project` | One-transaction wipe-and-rebuild of a project's rows |
| Database | `database/core.py:9` `get_connection`, `:19` `init_db` | Connection (FK enforcement on), schema and indexes |
| Search | `services/search.py:10` `search_project` | Weighted ranking, top-50 |
| Graphs | `services/graphs.py:49,111,187,236` | NetworkX file/call graphs, cycles, metrics |
| Analysis | `services/analysis.py:66` `ProjectIndex` and functions at `:394,454,481,542,665` | References, call hierarchy, impact, unused |
| History | `services/history.py` | Snapshot store, retention, integrity check, atomic writes |

### Frontend (`frontend/src/`)

| Component | File | Responsibility |
|---|---|---|
| Root / upload | `App.jsx` (`handleAnalyze` `:89`) | Upload form, tab routing, unsaved-change guard on tab switch (`:39-61`) |
| Shell | `components/AppShell.jsx` (`NAV_SECTIONS` `:8`) | Sidebar navigation (Dashboard, Search, File Explorer, Functions, Classes, Dependency Graphs, Statistics), project update from ZIP (`:54`) |
| Dashboard | `components/Dashboard.jsx:33` | Project summary, health rows |
| Search | `components/Search.jsx:18` | Query box, ranked results, navigation |
| File Explorer | `components/FileExplorer.jsx` | File tree, editor, validation, save, diff view, history view, discard/revert |
| Code editor | `components/CodeEditor.jsx` | Textarea editor, line gutter, Tab/Shift-Tab, Ctrl+S, change markers |
| Diff view | `components/DiffView.jsx:62` | Hunk display with per-hunk Revert |
| History view | `components/HistoryView.jsx:31` | Version list, preview, restore |
| Function / Class explorers | `FunctionExplorer.jsx`, `ClassExplorer.jsx` | Symbol lists and details; host CodeInsights tabs |
| Code insights | `components/CodeInsights.jsx:160` `SymbolInsights` | References, call hierarchy, impact, file impact views |
| Graphs | `components/DependencyGraphs.jsx:505` | React Flow canvas, layered layout (`:38`), cycle/unresolved panels |
| Statistics | `components/Statistics.jsx:52` | Counts and graph metrics |
| Utilities | `utils/lineDiff.js`, `utils/format.js` | Myers line diff and hunk revert; formatting/error helpers |

## 4. Data flow

### 4.1 Upload and indexing — VERIFIED
1. `App.jsx:108-116` posts `name` + `file` (multipart) to `POST /projects/analyze-upload`.
2. `main.py:121` `_save_upload_to_temp` streams the upload to a temp file in 1 MB chunks, enforcing `MAX_UPLOAD_BYTES` (`:93`, default 100 MB) → 413.
3. `main.py:147` `_extract_and_index_zip`: validates it is a ZIP; checks entry count (`:95`), every entry name (`:103` `_check_zip_member_name`: absolute, drive, `..`, NUL, depth), total declared size (`:94`, default 500 MB); then extracts entry by entry into `uploads/<uuid4>/` with a canonical containment check and skips symlink entries (`:99`).
4. Single top-level folder detection, then `indexer.index_project` (`indexer.py:13`): scan → parse → insert in **one SQLite transaction**; rollback on any error (`indexer.py:128-131`).
5. On any failure the extraction directory is removed (`main.py`, `except BaseException` block in `_extract_and_index_zip`).
6. Frontend fetches `GET /projects/{id}` and opens the Dashboard (`App.jsx:126-131`).

Sequence diagram from Phase 2: `sequence_upload_index.png`.

### 4.2 Save from editor — VERIFIED
`FileExplorer.jsx:438` `handleSave` → `POST /projects/{id}/files/save` → `main.py:496`
`_resolve_and_validate_project_file` (relative-path, `.py`, indexed in DB, canonical
containment) → `main.py:684` `_snapshot_current_file` (current bytes into history, save
aborted if this fails) → temp-file + `fsync` + `os.replace` atomic write → full project
re-index (`main.py:696`) → 200 or 207.

### 4.3 Restore a version — VERIFIED
`HistoryView.jsx:101` → `POST /projects/{id}/files/versions/{version_id}/restore` →
same path validation → `history.get_version` (regex-validated id, metadata must match
project and path, SHA-256 + size integrity check) → snapshot current file → atomic write
of exact snapshot bytes (`history.py:60`) → re-index.

### 4.4 Search and navigation — VERIFIED (backend), IMPLEMENTED (UI)
`Search.jsx:38` → `GET /projects/{id}/search?q=` → `search.py:10` → ranked list → click
navigates to file/line via `App.jsx:63` `handleNavigateToFile` or symbol via `:68`.
Phase 2 diagram: `sequence_search_navigation.png`.

## 5. Database design — IMPLEMENTED

Defined in `backend/app/database/core.py`. Connections enable `PRAGMA foreign_keys = ON` (`:13-15`).

| Table | Lines | Columns (abridged) | Relationships |
|---|---|---|---|
| `projects` | 28-34 | `id` PK, `name`, `root_path`, `indexed_at` | parent of all |
| `files` | 38-48 | `id`, `project_id`, `relative_path`, `language`, `line_count`, `source`, `parse_status`, `parse_error` | FK → projects, ON DELETE CASCADE |
| `symbols` | 53-68 | `id`, `deterministic_id`, `project_id`, `file_id`, `name`, `symbol_type`, `start_line`, `end_line`, `parent_id`, `parameters` (JSON), `docstring`, `bases` (JSON) | FK → projects, files (CASCADE) |
| `imports` | 73-83 | `id`, `project_id`, `file_id`, `module`, `imported_name`, `alias`, `line_number` | FK → projects, files (CASCADE) |
| `calls` | 88-97 | `id`, `project_id`, `file_id`, `caller_symbol_id`, `raw_callee_name`, `line_number` | FK → projects, files (CASCADE) |
| indexes | 99-113 | `project_id` on all four child tables; `file_id` on symbols/imports/calls | added in uncommitted Milestone 8 change |

Design notes (IMPLEMENTED):
- Full source text is stored in `files.source`, so viewing/searching does not re-read disk.
- Symbols are identified by a **deterministic id** `"relative/path.py::Outer.inner"`
  (`parser.py:68` `_make_symbol_id`), stable across re-indexing; numeric `files.id` values are not stable.
- `symbols.parent_id` and `calls.caller_symbol_id` hold deterministic ids (text), not FKs.
- Version history is **not** in SQLite: it is a file store at
  `version_history/<project_id>/<sha256(relative_path)>/<version_id>.{snapshot,json}` (`history.py:9-16`, `:55`).
- Database location: `codeseek.db` relative to the backend's working directory (`core.py:9`).

Phase 2 data-model diagrams: `class_diagram_conceptual_data_model.png`, ERD section in
`codeseek_p2_uml_diagrams.md` §8.

## 6. API endpoints — IMPLEMENTED

All in `backend/app/main.py` (decorator line shown). 23 endpoints.

| Method | Path | Line | Purpose |
|---|---|---|---|
| POST | `/projects/analyze` | 64 | Index a local directory (API only; not used by UI) |
| POST | `/projects/analyze-upload` | 250 | Upload + extract + index ZIP |
| POST | `/projects/{project_id}/update-upload` | 262 | Re-index existing project from new ZIP |
| GET | `/projects/{project_id}` | 284 | Overview and counts |
| GET | `/projects/{project_id}/files` | 326 | File list (no source) |
| GET | `/files/{file_id}` | 344 | One file incl. source |
| GET | `/projects/{project_id}/symbols` | 361 | Symbols, optional `type` filter |
| GET | `/projects/{project_id}/search` | 386 | Weighted search (`q`) |
| GET | `/symbols/{symbol_id:path}` | 403 | Symbol detail by deterministic id |
| GET | `/projects/{project_id}/dependencies/files` | 427 | File dependency graph + cycles |
| GET | `/projects/{project_id}/dependencies/functions` | 443 | Call graph + cycles |
| GET | `/projects/{project_id}/stats` | 459 | Graph metrics |
| POST | `/projects/{project_id}/files/validate` | 560 | `ast.parse` syntax check (no execution) |
| GET | `/projects/{project_id}/files/by-path` | 593 | File + symbols by relative path |
| POST | `/projects/{project_id}/files/save` | 627 | Snapshot, atomic write, re-index |
| GET | `/projects/{project_id}/files/versions` | 807 | List versions |
| GET | `/projects/{project_id}/files/versions/{version_id}` | 821 | Preview version |
| POST | `/projects/{project_id}/files/versions/{version_id}/restore` | 832 | Restore version |
| GET | `/projects/{project_id}/analysis/references` | 892 | References to a symbol |
| GET | `/projects/{project_id}/analysis/call-hierarchy` | 904 | Incoming/outgoing calls |
| GET | `/projects/{project_id}/analysis/impact` | 918 | Symbol change impact |
| GET | `/projects/{project_id}/analysis/file-impact` | 930 | File change impact |
| GET | `/projects/{project_id}/analysis/unused` | 942 | Potentially unused symbols |

FastAPI also serves interactive API docs at `/docs` (VERIFIED: `test_app_starts`).
There are **no** DELETE endpoints.
