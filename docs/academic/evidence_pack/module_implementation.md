# CodeSeek — Module Implementation (Evidence Pack)

> Line numbers refer to the working tree on 2026-10-31. "Introduced in" gives the commit
> that first added the module (see `git_and_team_evidence.md`). Status labels are defined
> in `project_overview.md`.

## Module dependency overview

```
scanner ──▶ parser ──▶ indexer ──▶ database(core)
                                      ▲   ▲   ▲
               search ────────────────┘   │   │
               graphs ────────────────────┘   │
               analysis ── uses graphs helpers ┘ (path_to_module, resolve_import_target, callee_short_name)
               history  (file store only, no DB)
main.py (API) ──▶ indexer, search, graphs, analysis, history
frontend utils/lineDiff ──▶ FileExplorer / DiffView / CodeEditor (client-side only)
```

Evidence: imports at the top of each file — `indexer.py:8-11`, `search.py:8`, `graphs.py:9`,
`analysis.py:27-28`, `main.py:25-35`.

---

## M1. Repository Scanner — VERIFIED
- **File:** `backend/app/services/scanner.py` — `scan_repository` (`:34`), `IGNORED_DIRS` (`:19-31`). Introduced in `7c95312`.
- **Input:** project root directory path.
- **Processing:** `os.walk`; prunes ignored directories in place (`.git`, `__pycache__`, `.venv`, `venv`, `env`, `node_modules`, `.mypy_cache`, `.pytest_cache`, `dist`, `build`, `.eggs`); keeps files ending `.py`; converts to `/`-separated relative paths.
- **Output:** sorted `list[str]` of relative paths (deterministic order).
- **Tests:** 6 in `tests/test_scanner.py` (e.g. `test_ignored_dirs_are_skipped`, `test_returned_paths_are_relative`).

## M2. AST Parser — VERIFIED
- **File:** `backend/app/services/parser.py`. Introduced in `40120ea`.
- **Key units:** `_make_symbol_id` (`:68`), `_get_callee_name` (`:94`), `_get_param_names` (`:133`), `_CodeVisitor(ast.NodeVisitor)` (`:165`) with `visit_ClassDef` (`:260`), `_visit_function` (`:310`), `visit_Import` (`:365`), `visit_ImportFrom` (`:381`), `visit_Call` (`:399`); `parse_file` (`:422`), `parse_repository` (`:513`), `_failure_result` (`:544`).
- **Input:** file path (+ project root).
- **Processing:** read with `utf-8-sig`, `errors="replace"`; `ast.parse`; visitor maintains a **scope stack** to classify `function` / `async_function` / `method` / `async_method` / `nested_function` / `class`, build deterministic ids, record parent ids and the enclosing caller of each call. Callee names are dotted strings (`obj.method`); they are **not** resolved here.
- **Output:** dict with `file_path`, `line_count`, `source_code`, `parse_ok`, `error`, `symbols`, `imports`, `calls` (`parser.py:18-57`).
- **Failure handling:** syntax/read errors return a failure dict instead of raising, so one bad file does not stop indexing (`:466-490`). VERIFIED by `test_syntax_error_does_not_stop_other_files`.
- **Tests:** 19 in `tests/test_parser.py`.

## M3. SQLite Storage and Indexer — VERIFIED
- **Files:** `backend/app/database/core.py` (`get_connection` `:9`, `init_db` `:19`); `backend/app/services/indexer.py` (`index_project` `:13`). Introduced in `8e18a18`.
- **Input:** project name, root directory, optional `update_project_id`.
- **Processing:** `init_db` (idempotent schema + indexes) → *new project:* delete any project with the same name (cascade), insert row; *update:* update root path and delete child rows → scan → parse → insert files, symbols, imports, calls → `commit`; any exception → `rollback` and re-raise (`indexer.py:128-134`).
- **Output:** `project_id`.
- **Property:** all-or-nothing re-index. VERIFIED by `test_indexer_failure_rolls_back_and_closes_connection`, `test_existing_index_remains_intact_after_failed_reindex_via_api`, `test_failed_update_upload_keeps_existing_project_index`.
- **Tests:** 4 in `tests/test_indexer.py` plus the above in other files.

## M4. Weighted Search — VERIFIED
- **File:** `backend/app/services/search.py` — `search_project` (`:10`). Introduced in `81ea276`.
- **Input:** project id, query string, `limit=50`.
- **Processing:** case-insensitive SQL `LIKE '%q%'` over calls, imports, symbols (name/parameters/docstring) and files (path/source); results accumulated in a dict keyed by result id; additive scores (`:14-22`): exact name +100, prefix +80, substring +60, path +40, parameter +30, docstring +20, import/call +15, raw source +5; sorted by `(-score, id)`.
- **Output:** up to 50 results with `score` and sorted `reasons`.
- **Tests:** 11 in `tests/test_search.py` (incl. `test_strong_symbol_outranks_source_code`, `test_top_50_limit`, `test_deterministic_tie_breaking`).

## M5. Dependency and Call Graphs — VERIFIED
- **File:** `backend/app/services/graphs.py`. Introduced in `dcb698e`; cycle analysis added in `e343ac2`.
- **Units:** `path_to_module` (`:15`), `resolve_import_target` (`:30`), `callee_short_name` (`:44`), `build_file_dependency_graph` (`:49`), `build_call_graph` (`:111`), `graph_to_json` (`:187`), `calculate_graph_metrics` (`:236`).
- **Processing:** file graph — node per file, edge per import that resolves to a project module (`from a import b` tries module `a.b` then `a`). Call graph — node per function/method; edge when the callee's last name segment matches **exactly one** function definition; otherwise recorded as unresolved with reason `ambiguous` / `not found`. Cycles via `networkx.simple_cycles`, capped at 50 (`:187`). Metrics: node/edge counts, average in/out degree, top-5 in-degree.
- **Output:** JSON `{nodes, edges, unresolved, cycles, self_loops, cycles_truncated, cycle_count, self_loop_count}`.
- **Frontend:** `DependencyGraphs.jsx` — layered left-to-right layout via iterative DFS topological order ignoring back edges (`:35-112`), cycle highlighting (`:135`), panels for unresolved items and cycles.
- **Tests:** 3 in `tests/test_graphs.py` + 2 API tests in `test_api.py`.

## M6. REST API and ZIP Upload — VERIFIED
- **File:** `backend/app/main.py`. FastAPI backend introduced in `5f4955b`; ZIP upload in `2f785f3`; hardening in uncommitted Milestone 8 work.
- **Upload safeguards (IMPLEMENTED + VERIFIED):** streamed size limit (`:121`); entry-count, nesting-depth and total-uncompressed-size limits (`:92-96`, configurable via `CODESEEK_MAX_UPLOAD_MB`, `CODESEEK_MAX_EXTRACTED_MB`, `CODESEEK_MAX_ZIP_ENTRIES`); rejection of absolute, drive-letter, `..` and NUL entry names (`:103`); canonical containment check; symlink entries skipped (`:99`); cleanup on failure; corrupt/encrypted archives → 400; filesystem errors → readable 500 with CORS headers.
- **Tests:** 25 in `tests/test_upload.py`.

## M7. Code Editor and Safe Saving — VERIFIED
- **Backend:** `main.py` — `_resolve_and_validate_project_file` (`:496`), `validate_project_file_source` (`:561`, `ast.parse` only), `save_project_file` (`:628`), `_snapshot_current_file` (`:684`), `_reindex_after_write` (`:696`). Introduced in `bc6176c`.
- **Frontend:** `CodeEditor.jsx` (textarea, synchronized gutter, Tab/Shift-Tab, Ctrl/Cmd+S, change markers); `FileExplorer.jsx` (`handleSave` `:438`, validation request `:237`, dirty state `:105`, `beforeunload` guard `:125-135`, discard modal `:292-318`).
- **Processing:** path validation → backup snapshot (abort save if it fails) → atomic write (temp file, `fsync`, `os.replace`) → full re-index → 200 / 207.
- **Tests:** 20 in `tests/test_editor.py` (incl. traversal, absolute path, Windows drive path, non-`.py` rejection, 207 partial success).
- **Not implemented:** syntax highlighting, autocompletion, multi-file editing.

## M8. Diff, Per-Hunk Revert and Discard All — VERIFIED (logic), IMPLEMENTED (UI)
- **Files:** `frontend/src/utils/lineDiff.js` — `myersOps` (`:22`), `backtrack` (`:58`), `diffLines` (`:98`), `lineMarkers` (`:168`), `revertHunk` (`:188`); `components/DiffView.jsx:62`; `FileExplorer.jsx` `handleRevertHunk` (`:320`), Discard All button (`:640`). Introduced in `278f9d2`.
- **Processing:** strip common prefix/suffix, then Myers shortest-edit-script on the middle (caps: edit distance 1000, 20,000 middle lines, `:14-15`; beyond the caps one simplified hunk is reported); group operations into `add` / `remove` / `modify` hunks; reverting a hunk splices saved lines back and rejects stale hunks.
- **Comparison base:** the last saved source vs. the editor buffer (client-side only; no server diff).
- **Tests:** 14 in `src/utils/lineDiff.test.js` (incl. randomized "revert all hunks restores saved source").

## M9. File Version History and Restore — VERIFIED
- **Files:** `backend/app/services/history.py` (store), `main.py:779-875` (endpoints), `frontend/src/components/HistoryView.jsx`. Introduced in `278f9d2`.
- **Processing:** before every save/restore, snapshot current bytes (exact bytes, BOM and line endings preserved); version id `<16-digit µs timestamp>-<12 hex>` validated by regex (`history.py:36`); storage path derived only from project id + SHA-256 of the relative path; metadata must match project and path (`:115`); size + SHA-256 integrity check on read (`:173`); duplicates of the newest version are not stored; retention keeps the newest 10 (`MAX_VERSIONS_PER_FILE`, `:33`, `prune_versions` `:223`).
- **Tests:** 27 in `tests/test_history.py` (incl. `test_cross_project_and_cross_file_access_rejected`, `test_corrupted_snapshot_is_not_restored`, `test_retention_keeps_latest_ten_versions`).

## M10. Code Intelligence — VERIFIED
- **Files:** `backend/app/services/analysis.py`; endpoints `main.py:880-946`; UI `frontend/src/components/CodeInsights.jsx`, `analysisHooks.js`. Introduced in `278f9d2`.
- **`ProjectIndex` (`:66`):** loads one project's files, symbols, calls and imports in four queries into dictionaries (`symbols`, `functions_by_name`, `classes_by_name`, `method_names_by_class`, `module_to_file`).
- **References (`find_references` `:394`):** calls/instantiations matching the short name, import references, subclass references; each labelled `resolved` (one candidate) / `ambiguous` (several, `:243`) / `name_match`.
- **Call hierarchy (`call_hierarchy` `:454`):** incoming callers and outgoing callees of a function/method; rejects classes (`NotAFunction`).
- **Impact (`symbol_impact` `:481`, `file_impact` `:542`):** direct (one-hop) dependents — callers, methods, subclasses, base classes, method callers; for files, imports in both directions and cross-file calls. **Transitive impact is not computed.**
- **Potentially unused (`potentially_unused` `:665`):** identifier-occurrence counting across all source with exclusions (`_exclusion_reason` `:635`): nested functions, dunder methods, entry points (`main`, `__main__.py`, `setup.py`, …), tests, decorated symbols (`_is_decorated` `:609`), framework hooks (external base class), overrides. Every result carries the caveat text `UNUSED_CAVEAT` (`:36`).
- **Tests:** 15 in `tests/test_analysis.py`.

## M11. Frontend Shell, Explorers, Dashboard, Statistics — IMPLEMENTED
- `App.jsx`, `AppShell.jsx`, `Dashboard.jsx`, `Search.jsx`, `FileExplorer.jsx`, `FunctionExplorer.jsx`, `ClassExplorer.jsx`, `Statistics.jsx`, `ui/ui.jsx`, `ui/Icon.jsx`.
- Introduced across `f680cd0` … `6db1789` (2026-09-12) and redesigned in `278f9d2`.
- **Automated UI/component tests: none** (only utility tests run under `node --test`).

---

## Implemented vs. planned

| Item | Status | Evidence |
|---|---|---|
| All modules M1–M11 above | IMPLEMENTED | source files listed |
| AI / LLM assistant, semantic or vector search | PLANNED/DEFERRED (explicitly out of scope) | `KNOWN_LIMITATIONS.md` "No Semantic AI Search"; `CodeSeek_Plan.md:65,87` |
| GitHub / Git integration | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md` "No GitHub Integration" |
| Multi-language support | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md` "Python Only" |
| Incremental indexing / file watchers | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md`; every save re-indexes the whole project (`main.py:696`) |
| Authentication / multi-user | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md` "No Authentication" |
| Project deletion / upload cleanup | NOT IMPLEMENTED | no DELETE route in `main.py` |
| Transitive (multi-hop) impact analysis | NOT IMPLEMENTED | `analysis.py:481-606` is one-hop |
