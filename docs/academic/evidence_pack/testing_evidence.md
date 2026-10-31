# CodeSeek — Testing Evidence (Evidence Pack)

> Status labels are defined in `project_overview.md`. Every result below was observed
> during the audit session on 2026-10-31; nothing is estimated.

## 1. Test inventory

### Backend — pytest (`backend/tests/`)

| File | Tests collected | Focus |
|---|---|---|
| `test_scanner.py` | 6 | file discovery, ignored directories, relative paths |
| `test_parser.py` | 19 | symbol kinds, imports, calls, inheritance, nesting, async, syntax errors, deterministic ids, parameters, docstrings, line numbers |
| `test_indexer.py` | 4 | counts, re-indexing, parse failures, DB indexes |
| `test_search.py` | 11 | ranking order, case-insensitivity, empty query, top-50 limit, tie-breaking |
| `test_graphs.py` | 3 | file graph, call graph, cycles and self-loops |
| `test_api.py` | 14 | endpoints for overview, files, symbols, search, symbol detail, graphs, stats, 404s |
| `test_upload.py` | 25 (incl. parametrised) | valid/wrapped ZIP, non-ZIP, malformed, Zip Slip, absolute/drive/`..` names, symlinks, ZIP bomb, entry count, nesting, oversize, corrupt member, cleanup, update, CORS on errors |
| `test_editor.py` | 20 | validate, by-path, save, path-traversal rejection, 207 partial success, rollback |
| `test_history.py` | 27 (incl. parametrised) | snapshots, BOM/CRLF preservation, scoping, restore, undo, invalid ids, cross-project access, retention (10), corrupted snapshot |
| `test_analysis.py` | 15 | references, call hierarchy, impact, file impact, unused, project isolation, stale rows |
| `conftest.py` | — | session-wide isolation fixture (uncommitted, see §2) |
| **Total** | **144** | |

### Frontend — Node built-in test runner (`frontend/src/utils/*.test.js`)

| File | Tests | Focus |
|---|---|---|
| `lineDiff.test.js` | 14 | diff hunks (add/remove/modify), start/end edits, empty files, trailing newline, independent and randomized revert, stale-hunk rejection, large-rewrite simplification, gutter markers |
| `format.test.js` | 3 | request-error messages (uncommitted) |
| **Total** | **17** | |

No React component tests, browser end-to-end tests (e.g. Playwright/Cypress), or
coverage measurement exist. **Code coverage percentage: UNKNOWN (not measured).**

## 2. Test safety (inspected before running)

- `backend/tests/conftest.py` (uncommitted) runs a **session-scoped autouse fixture** that
  changes the working directory to a pytest temporary folder (so the CWD-relative
  `codeseek.db` is a temporary DB), points `main._UPLOADS_ROOT` and
  `history.HISTORY_ROOT` at temporary folders, and **asserts at the end that the real
  `backend/codeseek.db`, `backend/uploads/` and `backend/version_history/` were not modified**.
- `test_history.py` and `test_analysis.py` additionally use per-test `tmp_path` + `monkeypatch.chdir`.
- **Historical risk:** at commit `278f9d2` (HEAD), `conftest.py` does not exist and
  `test_api.py` deleted `backend/codeseek.db`; `test_editor.py`/`test_upload.py` wrote to the
  real DB and `backend/uploads/`. Running the suite from a clean checkout of HEAD is therefore
  **unsafe for real data** until the working-tree fixes are committed.

## 3. Commands and actual results

Environment: Windows 11 (10.0.26200), Python 3.12.14, pytest 9.1.1, Node.js v24.15.0, npm 11.12.1.

| Command (run from) | Run time | Result |
|---|---|---|
| `.\.venv\Scripts\python.exe -m pytest -v -p no:cacheprovider` (`backend/`) | 2026-10-31 19:04 IST | **144 passed, 0 failed**, 2 deprecation warnings, 16.21 s, exit 0 — VERIFIED |
| `npm test` (`frontend/`) | 2026-10-31 | **17 passed, 0 failed** — VERIFIED |
| `npx oxlint` / `npm run lint` (`frontend/`) | 2026-10-31 | **0 errors, 8 warnings** (6 × `react(set-state-in-effect)`, 2 × `react-hooks(exhaustive-deps)` in `ClassExplorer`, `FunctionExplorer`, `DependencyGraphs`, `FileExplorer`) — VERIFIED |
| `npm run build` (`frontend/`) | earlier on 2026-10-31 (not re-run for this pack, to avoid overwriting `dist/`) | succeeded; warning: main JS chunk 523 kB (> 500 kB) |

Warnings (backend): `StarletteDeprecationWarning` (httpx with TestClient) and an `anyio`
deprecation, both from installed libraries, not from CodeSeek code.

Full verbose pytest output was saved outside the repository (audit scratch file). Re-run the
command above and save the output in the report appendix.

## 4. Failed tests and known existing failures

| Test | Status at HEAD `278f9d2` | Status in working tree | Cause |
|---|---|---|---|
| `tests/test_graphs.py::test_cycles` | **FAILED** (observed 2026-10-31) | passes | Test data inserted `calls` rows without the `NOT NULL` column `file_id`; the open connection then masked the `IntegrityError` with a Windows `PermissionError`. Fixed by supplying `file_id` in the fixture data; assertions unchanged. |

No other failures were observed. Earlier runs at HEAD are not trustworthy as evidence
because they used the real database (§2).

## 5. Integration testing coverage

| Integration path | Covered by | Status |
|---|---|---|
| HTTP → upload → extract → scan → parse → SQLite | `test_upload.py` (FastAPI `TestClient`) | VERIFIED |
| HTTP → save → snapshot → atomic write → re-index | `test_editor.py`, `test_history.py` | VERIFIED |
| HTTP → restore → integrity check → write → re-index | `test_history.py` | VERIFIED |
| HTTP → analysis endpoints over a real index | `test_analysis.py` | VERIFIED |
| Index → graph construction → JSON | `test_graphs.py`, `test_api.py` | VERIFIED |
| Live server (uvicorn) end-to-end over HTTP | ad-hoc smoke script during audit: 29/29 checks passed (upload, overview, files, symbols, search, symbol/file detail, by-path, validate, save, versions, preview, restore, traversal rejection, cross-project rejection, 5 analysis endpoints, graphs, stats, update-upload, bad ZIP, CORS allow/deny) | VERIFIED (one run, isolated data) |
| Browser UI ↔ backend (real clicks) | none | **NOT VERIFIED** |

## 6. Functional vs. non-functional coverage

**Functional (automated):** scanning, parsing, indexing, search ranking, graphs, all REST
endpoints, editing/saving, version history, code intelligence, client-side diff/revert.

**Non-functional:**

| Property | Evidence | Status |
|---|---|---|
| Security — ZIP path traversal, absolute/drive paths, symlinks, ZIP bomb, entry/nesting limits | `test_upload.py` | VERIFIED |
| Security — editor/history path containment, cross-project version access | `test_editor.py`, `test_history.py` | VERIFIED |
| Security — CORS restriction | live smoke check (§5), `test_upload_errors_include_cors_headers` | VERIFIED |
| Reliability — transaction rollback, atomic writes, failed-save/restore safety, corrupted snapshot rejection | `test_editor.py`, `test_history.py`, `test_upload.py` | VERIFIED |
| Data isolation between projects | `test_analysis_is_isolated_between_projects`, `test_cross_project_and_cross_file_access_rejected` | VERIFIED |
| Performance | single-run measurements, see `algorithms_and_data_structures.md` §8 | PARTIAL (not repeated, synthetic data) |
| Usability, accessibility, browser compatibility | none | UNKNOWN |
| Concurrency (simultaneous saves/uploads) | none | UNKNOWN |

## 7. Test cases recommended for live demonstration

1. **Parser robustness:** `test_syntax_error_does_not_stop_other_files` — one broken file does not stop indexing.
2. **Search ranking:** `test_strong_symbol_outranks_source_code`.
3. **Zip Slip rejection:** `test_upload_zip_slip_rejected` and the parametrised drive/absolute-path cases.
4. **ZIP bomb protection:** `test_upload_rejects_excessive_extracted_size`.
5. **Safe save:** `test_save_file_reindex_failure_returns_207_and_preserves_disk`.
6. **Rollback:** `test_existing_index_remains_intact_after_failed_reindex_via_api`.
7. **History integrity:** `test_corrupted_snapshot_is_not_restored`, `test_retention_keeps_latest_ten_versions`.
8. **Code intelligence:** `test_class_references_include_instantiation_imports_reexports_and_subclasses`.
9. **Diff correctness:** `reverting all hunks restores the saved source exactly (randomized)` (`npm test`).

Example: `.\.venv\Scripts\python.exe -m pytest -v tests/test_upload.py -k "slip or bomb or extracted_size"`.
