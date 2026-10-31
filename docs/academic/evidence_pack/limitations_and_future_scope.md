# CodeSeek — Limitations and Future Scope (Evidence Pack)

> Status labels are defined in `project_overview.md`. Line numbers refer to the working
> tree on 2026-10-31.

## 1. Confirmed limitations (verified by reading the code)

| # | Limitation | Evidence |
|---|---|---|
| L1 | Only Python `.py` files are indexed. | `scanner.py:34` (filter on `.py`); `KNOWN_LIMITATIONS.md` |
| L2 | Static, name-based resolution only. A call resolves only if its last name segment matches exactly one function; there is no type inference, so `self.x()` and `obj.save()` with several `save` definitions stay ambiguous or unresolved. | `graphs.py:111-185`; `analysis.py:180`, `:243` |
| L3 | Dynamic behaviour (reflection, `getattr`, decorators, registries, dynamic imports) is invisible. "Potentially unused" can be a false positive, and the UI shows a caveat. | `analysis.py:30-41` (`STATIC_NOTICE`, `UNUSED_CAVEAT`) |
| L4 | Impact analysis is one hop (direct dependents only). | `analysis.py:481-607` |
| L5 | Every save or restore re-indexes the **whole** project (no incremental indexing). | `main.py:696` → `index_project`; `KNOWN_LIMITATIONS.md` |
| L6 | Uploading a project with an **existing name replaces** that project (DELETE by name, with cascade). Version history of the old project id is no longer reachable. | `indexer.py:43` |
| L7 | Extracted uploads under `backend/uploads/` are never deleted, including after updates. There is no delete-project endpoint. | `main.py` (no DELETE route); `KNOWN_LIMITATIONS.md` |
| L8 | Single-user, localhost only, no authentication or authorisation. `/projects/analyze` can index any local directory path. | `main.py:64`, `:952-955`; `KNOWN_LIMITATIONS.md` |
| L9 | The frontend API URL is hard-coded to `http://127.0.0.1:8000`. | `analysisHooks.js:7` and inline URLs |
| L10 | The DB path is relative to the backend's working directory, so the backend must be started from `backend/`. | `database/core.py:9` |
| L11 | Search uses `LIKE '%q%'` (full scan per query, substring only, no stemming or fuzzy matching), capped at 50 results. | `search.py:10-217` |
| L12 | Cycle enumeration stops at 50 cycles (`cycles_truncated` is set). | `graphs.py:187` |
| L13 | Version history keeps the newest 10 versions per file. History is keyed by project id, so if the DB is deleted and ids restart, old history could attach to a new project with the same id and path. | `history.py:33`, `:55` |
| L14 | The editor is a textarea: no syntax highlighting, autocompletion or multi-file editing. | `CodeEditor.jsx` |
| L15 | Edits are made to the extracted copy in `backend/uploads/`, not to the user's original project; there is no export/download of edited files. | `main.py:147` (extraction root), no download endpoint |
| L16 | Upload limits: 100 MB upload, 500 MB uncompressed, 20,000 entries, depth 64 (configurable). | `main.py:92-96` |
| L17 | `node_modules`, `venv`, `build`, `dist` and similar folders are skipped. A ZIP whose Python files are all inside them indexes **0 files** (observed with `node.zip` on 2026-10-31). | `scanner.py:19-31` |
| L18 | The production JS bundle is 523 kB (Vite warns above 500 kB); there is no code-splitting. | `npm run build` output |
| L19 | The repository tracks generated content (`backend/.venv/`, `node/`, `node.zip`, `.db` files, `backend/uploads/`). | `git ls-files`; see `git_and_team_evidence.md` §3 |

## 2. Untested or unverified scenarios

| Scenario | Status |
|---|---|
| Full UI click-through in a browser (all screens), browser console errors | UNKNOWN: not verified in this audit |
| React component behaviour (no component tests exist) | UNKNOWN |
| Real-world large open-source projects (e.g. Django-sized) | UNKNOWN: only a synthetic 800-file project was measured |
| Browser rendering performance of large graphs (2.8 MB call-graph JSON at 800 files) | UNKNOWN |
| Concurrent uploads/saves from several tabs | UNKNOWN |
| Non-UTF-8 source files (decoded with `errors="replace"`) | PARTIAL: decoding is handled; display fidelity not tested |
| Files with Windows path length > 260 characters | UNKNOWN |
| macOS/Linux | UNKNOWN: developed and tested on Windows only |
| Browsers other than the one used in development | UNKNOWN |
| Accessibility (keyboard-only, screen reader) | UNKNOWN |
| Cause of the variable upload latency (10–26 s for S800) | UNKNOWN |

## 3. Planned or deferred (not implemented)

| Feature | Status | Evidence |
|---|---|---|
| AI assistant / LLM explanations / semantic (vector) search | DEFERRED (cost, scope) | `KNOWN_LIMITATIONS.md` "No Semantic AI Search"; `CodeSeek_Plan.md:65,87` |
| GitHub / Git integration | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md` "No GitHub Integration" |
| Multi-language support | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md` "Python Only" |
| Incremental indexing / file watching | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md` |
| Authentication, multi-user, cloud deployment | NOT IMPLEMENTED | `KNOWN_LIMITATIONS.md` "No Authentication" |

## 4. Realistic future enhancements

Ordered roughly by value for effort. **None of these are implemented.**

1. **Incremental re-indexing on save:** re-parse only the saved file and update its rows.
   This would cut save latency, which is currently a full re-index (§8.3 of
   `algorithms_and_data_structures.md`).
2. **Project management:** delete a project and clean up its uploads and history; warn
   before a same-name upload replaces an existing project.
3. **Export edited files** as a ZIP or patch.
4. **SQLite FTS5 full-text search** in place of `LIKE`, for faster ranked text search.
5. **Better call resolution:** use imports and `self`/class context to narrow the
   candidates; transitive (multi-hop) impact analysis with a depth limit.
6. **Syntax highlighting** in the editor (e.g. CodeMirror or Monaco). This would add a dependency.
7. **Configurable API URL** through Vite environment variables.
8. **Graph scalability:** server-side filtering or clustering, and code-splitting the frontend bundle.
9. **Component and end-to-end tests** (e.g. Vitest + React Testing Library, Playwright).
10. **Optional AI explanations** behind a feature flag, if cost constraints allow (deferred today).
11. **Additional languages** through tree-sitter (large scope).
