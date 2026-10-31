# CodeSeek

CodeSeek is a local, browser-based tool for exploring and safely editing Python projects.
You upload a project as a `.zip`, CodeSeek indexes it with Python's `ast` module (static
analysis only, uploaded code is never executed), and you can then search, navigate,
inspect dependencies and edit files with version history.

## Main features

- **Project upload and indexing**: upload a `.zip` of a Python project; files, classes,
  functions, methods, imports and calls are indexed into SQLite. Re-upload a newer ZIP
  to update an existing project.
- **Search**: weighted search across symbols, file paths, docstrings, imports, calls and source.
- **Explorers**: file, class and function explorers with source view and symbol details.
- **Code editor**: in-browser Python editor with syntax validation, atomic saving and
  automatic re-indexing, plus a warning before leaving with unsaved changes.
- **Diff and revert**: review changes against the saved file, revert individual hunks or discard all.
- **Version history**: every save or restore first snapshots the previous file contents.
  You can preview and restore any of the last 10 versions per file.
- **Code intelligence**: references, call hierarchy, change impact (symbol and file)
  and potentially unused functions and classes.
- **Dependency graphs and statistics**: file import graph and function call graph with
  cycle detection and graph metrics.

Only Python (`.py`) files are indexed. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Requirements

- Windows 10/11 (macOS and Linux work too; commands below are for Windows PowerShell)
- Python 3.10+ (developed and tested with Python 3.12)
- Node.js 18+ and npm (tested with Node 20 and 24)

## Installation (Windows)

### 1. Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If PowerShell refuses to run `Activate.ps1`, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or call the venv's Python
directly: `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`.

### 2. Frontend

```powershell
cd frontend
npm install
```

## Running CodeSeek

Start both servers, each in its own terminal.

**Backend** (from the `backend` folder, with the virtual environment active):

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app
```

`--reload-dir app` is important: it restricts auto-reload to the application code.
Without it, uvicorn also watches `uploads/` and `version_history/`, so every upload or save
would restart the server mid-request. Alternatively, run `python -m app.main`, which uses
the same settings.

**Frontend** (from the `frontend` folder):

```powershell
npm run dev
```

Open http://localhost:5173 in your browser. The API docs are at http://127.0.0.1:8000/docs.

The frontend expects the API at `http://127.0.0.1:8000`, and the backend accepts browser
requests (CORS) only from `http://localhost:5173`, `http://127.0.0.1:5173` and
`http://localhost:3000`. Keep these ports.

## Where data is stored

All data stays on your machine:

| Data | Location |
| --- | --- |
| Index database | `codeseek.db` in the directory the backend is started from (normally `backend/codeseek.db`) |
| Extracted uploads | `backend/uploads/<uuid>/` |
| Version history | `backend/version_history/<project_id>/...` |

Always start the backend from the `backend` folder, so it uses `backend/codeseek.db`.

Edits made in CodeSeek are written to the extracted copy in `backend/uploads/`, not to
your original project. Extracted uploads are kept so files can be viewed and edited, and
updating a project by re-uploading keeps the previous extraction on disk. Remove old
folders manually if you need the space (see Known limitations).

Uploading a project with the **same name** as an existing project replaces that
project's index. To keep both, use a different name; to update a project, use the update
(re-upload) action in the project sidebar.

## Configuration

Optional environment variables (set before starting the backend):

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODESEEK_MAX_UPLOAD_MB` | `100` | Maximum size of an uploaded ZIP |
| `CODESEEK_MAX_EXTRACTED_MB` | `500` | Maximum total uncompressed size of a ZIP |
| `CODESEEK_MAX_ZIP_ENTRIES` | `20000` | Maximum number of entries in a ZIP |
| `CODESEEK_UPLOADS_DIR` | `backend/uploads` | Where uploads are extracted |
| `CODESEEK_HISTORY_DIR` | `backend/version_history` | Where version snapshots are stored |

Example (PowerShell): `$env:CODESEEK_MAX_UPLOAD_MB = "250"`, then start uvicorn.

No API keys or `.env` file are required.

## Running the tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q

cd ..\frontend
npm test
npm run lint
npm run build
```

The backend tests run against a temporary database, uploads folder and history folder
(see `backend/tests/conftest.py`). They never touch `backend/codeseek.db` or your uploaded
projects, and the suite fails if real data changes during a run.

## Troubleshooting

- **`ModuleNotFoundError: No module named 'app'`**: start uvicorn from the `backend` folder.
- **"Failed to fetch" / CORS errors in the browser console**: the backend is not running
  on `127.0.0.1:8000`, or the frontend is not on port 5173. Check both terminals.
- **Port already in use**: another CodeSeek instance is running. Close it, or find the
  process with `netstat -ano | findstr :8000`.
- **The backend restarts whenever you upload or save**: you started uvicorn with
  `--reload` but without `--reload-dir app`.
- **Projects disappeared after restarting**: the backend was started from a different
  folder, so it created a new `codeseek.db` there. Start it from `backend`.
- **Upload rejected (400/413)**: the ZIP is not a valid ZIP, is encrypted, contains
  unsafe paths, or exceeds a size or entry limit (see Configuration).
- **Save returned a warning that re-indexing failed**: the file *was* saved to disk, but
  symbols and graphs may be stale. Saving again, or re-uploading, refreshes the index.
- **`npm` not recognised**: install Node.js and reopen the terminal.

## Security and data-handling notes

CodeSeek is a **single-user local development tool**. It has no authentication, so do not
expose the backend beyond `127.0.0.1`.

- Uploaded code is only parsed with `ast`; it is never imported or executed.
- ZIP uploads are validated before extraction. Absolute paths, drive letters and `..`
  traversal are rejected; symlink entries are skipped; size, entry-count and nesting limits
  guard against ZIP bombs; and failed uploads are cleaned up.
- Editing, saving, history and restore only operate on indexed `.py` files inside the
  project directory. Paths are canonicalised and checked against the project root.
- Version IDs are validated and scoped to a single project and file.
- Saves and restores are atomic (temporary file plus replace), and the previous contents
  are always snapshotted first. If indexing fails, the previous index is kept (single
  transaction).
- Error responses do not include stack traces; details are logged on the server console.
- The `/projects/analyze` API endpoint (not used by the UI) indexes an arbitrary local
  directory path. It exists for local scripting; keep the server bound to localhost.
