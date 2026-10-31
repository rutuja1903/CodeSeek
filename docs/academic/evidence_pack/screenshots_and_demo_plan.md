# CodeSeek — Screenshots and Demonstration Plan (Evidence Pack)

## 1. What exists today

**No application screenshots exist in the repository** (checked 2026-10-31 with
`git ls-files` for image files). The only committed images are:

| File | Content |
|---|---|
| `use_case_diagram.png` | Phase 2 UML use-case diagram |
| `activity_diagram_repository_analysis.png` | Phase 2 activity diagram |
| `sequence_upload_index.png` | Phase 2 sequence diagram: upload and indexing |
| `sequence_search_navigation.png` | Phase 2 sequence diagram: search and navigation |
| `class_diagram_conceptual_data_model.png` | Phase 2 conceptual data model |
| `component_diagram.png` | Phase 2 component diagram |
| `deployment_diagram.png` | Phase 2 deployment diagram |
| `codeseek_p2_uml_diagrams.pdf` / `.md` | Source and PDF of the above |
| `frontend/src/assets/hero.png`, `react.svg`, `vite.svg` | Vite/React template assets (not CodeSeek screens) |

The Phase 2 diagrams were drawn before Milestones 3–8. **Check that they still match** the
current system: they predate the editor, history, diff and code-intelligence modules.

All screenshots below must be captured manually by the students.

## 2. Application screens (from `frontend/src/components/AppShell.jsx:8-31` and `App.jsx`)

| # | Screen | Component | How to reach |
|---|---|---|---|
| S1 | Upload / home | `App.jsx` | start page |
| S2 | Dashboard | `Dashboard.jsx` | sidebar → Workspace → Dashboard |
| S3 | Search | `Search.jsx` | sidebar → Search |
| S4 | File Explorer: source view | `FileExplorer.jsx` + `CodeEditor.jsx` | sidebar → File Explorer, pick a file |
| S5 | Editor with syntax-error validation | `FileExplorer.jsx` | introduce an error, e.g. `def x(:` |
| S6 | Unsaved-changes view (diff hunks with Revert) | `DiffView.jsx` | edit a file, open the "changes" view |
| S7 | Discard confirmation dialog | `FileExplorer.jsx` / `ui.jsx` | Discard All, or switch file while dirty |
| S8 | Version history: list + preview | `HistoryView.jsx` | save twice, open history |
| S9 | Restore confirmation and result | `HistoryView.jsx` | restore an older version |
| S10 | Functions explorer + Call hierarchy tab | `FunctionExplorer.jsx` + `CodeInsights.jsx` | sidebar → Functions |
| S11 | Classes explorer + References / Impact tab | `ClassExplorer.jsx` + `CodeInsights.jsx` | sidebar → Classes |
| S12 | Potentially unused list | `CodeInsights.jsx` / `analysisHooks.js` | Functions or Classes "unused" filter |
| S13 | File dependency graph with a cycle highlighted | `DependencyGraphs.jsx` | sidebar → Dependency Graphs |
| S14 | Function call graph + unresolved panel | `DependencyGraphs.jsx` | switch graph type |
| S15 | Statistics | `Statistics.jsx` | sidebar → Statistics |
| S16 | Update project from ZIP | `AppShell.jsx:54` | sidebar update button |
| S17 | Rejected upload error message (e.g. not a ZIP) | `App.jsx` | upload a `.txt` renamed or a corrupt ZIP |
| S18 | FastAPI docs | backend `/docs` | `http://127.0.0.1:8000/docs` |
| S19 | Terminal: `pytest` 144 passed, `npm test` 17 passed | — | run the commands in `testing_evidence.md` §3 |

## 3. Recommended screenshots per evaluation

| Evaluation | Recommended screens | Rationale |
|---|---|---|
| **Phase 3** (core implementation) | S1, S2, S3, S4, S5, S13, S14, S15, S18 | upload, indexing, search, navigation, graphs, the core analysis pipeline, editor validation |
| **Phase 4** (advanced features, testing) | S6, S7, S8, S9, S10, S11, S12, S16, S17, S19 | diff/revert, history/restore, code intelligence, error handling, test evidence |
| **ESE report / presentation / poster** | S2 (hero image), S13 (graph with cycle), S10 or S11 (code intelligence), S6 (diff), S8 (history), S19 (tests) + architecture diagram from `architecture.md` §1 | one image per headline capability; the poster needs few, high-contrast screens |

Capture tips: use the bundled `sample_projects/sample_shop` (zip it, or use `sample_shop.zip`)
so the screens are reproducible; keep the browser window at a fixed size; crop out personal
file paths visible in the sidebar tooltip (`AppShell.jsx:105` shows `root_path`).

## 4. End-to-end live demonstration (≈10–12 minutes)

**Preparation (before the panel arrives)**
1. Terminal A, in `backend/`: `uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir app`.
2. Terminal B, in `frontend/`: `npm run dev`; open `http://localhost:5173`.
3. Have `sample_shop.zip` ready, and prepare a second ZIP of the project with one extra
   `.py` file for the update step. Note: the committed `sample_shop_v2/` folder is currently
   **identical** to `sample_projects/sample_shop/` (checked with `diff -rq` on 2026-10-31), so
   add a file to a copy yourself.
4. Optionally use a fresh backend working directory so the demo DB is clean (the DB is
   `codeseek.db` in the folder uvicorn is started from).

**Sequence**
1. **Upload and index** `sample_shop.zip` → the Dashboard shows file/symbol/import/call counts (S1→S2).
2. **Search** for `validate_email` → the exact match ranks first; click it to open the file at the definition (S3→S4).
3. **Graphs**: show the file dependency graph and then the call graph; open the unresolved panel and explain name-based resolution (S13, S14).
4. **Code intelligence**: open a class → References and Impact; open a function → Call hierarchy; show the potentially-unused list and its caveat (S10–S12).
5. **Edit**: introduce a syntax error → validation error shown; fix it → edit two separate places → the changes view shows two hunks → revert one hunk (S5, S6).
6. **Unsaved-change protection**: try switching file → confirmation dialog (S7).
7. **Save** → re-index; the search result or line numbers update.
8. **Version history**: open history → preview the previous version → restore → explain that the restore itself made a backup (S8, S9).
9. **Update project** from the v2 ZIP → the file count increases (S16).
10. **Safety**: upload an invalid file → clear error message (S17).
11. **Tests**: run `pytest -v tests/test_upload.py -k slip` and `npm test` in a terminal (S19).

**Fallbacks:** if the backend is stopped, the UI shows "Could not reach the CodeSeek
backend…" (uncommitted `format.js` change). Keep recorded screenshots as a backup if live
running fails.

## 5. Not verified

The UI flow above was **not** clicked through in a browser during this audit (only API-level
checks were run). Rehearse it at least once and note any console errors.
