# CodeSeek — Git and Team Evidence (Evidence Pack)

> Collected on 2026-10-31 with read-only Git commands (`git remote -v`, `git branch -a -vv`,
> `git log --all`, `git shortlog -sne --all`, `git show --stat`, `git ls-remote`).
> No Git state was changed.

## 1. Repository

| Item | Value | Source |
|---|---|---|
| Remote URL | `https://github.com/rutuja1903/CodeSeek.git` | `git remote -v` |
| Current branch | `main` | `git branch -vv` |
| HEAD | `278f9d2` — "Polish CodeSeek UI and complete workspace redesign" (2026-10-31 03:03:57 +05:30) | `git log` |
| Remote `main` | `278f9d2` (same as local; verified with `git ls-remote origin refs/heads/main`) | audit, 2026-10-31 |
| Tags | none | `git tag` |

## 2. Branching structure

Single branch. Local `main` tracks `origin/main`; `origin/HEAD → origin/main`. No feature
branches, merge commits, or pull-request merge commits exist in the history; all 21
commits are linear on `main`.

## 3. Commit history (oldest last)

All dates are author dates as recorded by Git (IST, +05:30).

| # | Commit | Date | Message | Main files (excluding vendored/upload files) |
|---|---|---|---|---|
| 21 | `278f9d2` | 2026-10-31 03:03 | Polish CodeSeek UI and complete workspace redesign | **also adds** `services/history.py`, `services/analysis.py`, `tests/test_history.py`, `tests/test_analysis.py`, `utils/lineDiff.js`(+tests), `DiffView.jsx`, `HistoryView.jsx`, `CodeInsights.jsx`; main.py +241 |
| 20 | `bc6176c` | 2026-10-31 00:17 | Implement Phase 3 code editor and safe file saving | `main.py`, `indexer.py`, `tests/test_editor.py`, `CodeEditor.jsx`, `FileExplorer.jsx` |
| 19 | `bbef248` | 2026-10-28 22:49 | docs: add Phase 2 UML diagrams and source | 7 PNG diagrams, `codeseek_p2_uml_diagrams.md/.pdf` |
| 18 | `e343ac2` | 2026-09-23 23:39 | feat: add code navigation and dependency cycle analysis | `graphs.py`, `test_graphs.py`, explorers, `CODESEEK_DETAILED_EXPLANATION.md` (+2,093 vendored files) |
| 17 | `5cdcea0` | 2026-09-12 18:32 | chore: ignore local database and uploaded repositories | `.gitignore`, removes `backend/codeseek.db` |
| 16 | `76452d7` | 2026-09-12 18:23 | chore: finalize MVP polish and documentation | `KNOWN_LIMITATIONS.md`, `main.py`, `indexer.py`, `test_upload.py`, `sample_shop_v2/` |
| 15 | `2f785f3` | 2026-09-12 17:57 | feat: add ZIP repository upload | `main.py`, `test_upload.py`, `App.jsx`, `sample_shop.zip` |
| 14 | `6db1789` | 2026-09-12 17:22 | feat: add repository statistics screen | `Statistics.jsx` |
| 13 | `6adcdf7` | 2026-09-12 17:03 | feat: add dependency graph visualizations | `DependencyGraphs.jsx`, `package.json` |
| 12 | `bf4c881` | 2026-09-12 16:50 | feat: add class explorer | `ClassExplorer.jsx` |
| 11 | `457a13b` | 2026-09-12 16:42 | feat: add function and method explorer | `FunctionExplorer.jsx` |
| 10 | `b99f95a` | 2026-09-12 16:35 | refactor: improve desktop workspace layout | `AppShell.jsx`, `Dashboard.jsx`, `FileExplorer.jsx`, `Search.jsx` |
| 9 | `aa2f751` | 2026-09-12 16:20 | feat: add global search screen | `Search.jsx`, `Dashboard.jsx` |
| 8 | `f680cd0` | 2026-09-12 16:11 | feat: add React home analysis screen | frontend scaffold, `node.zip` (+1,962 vendored files) |
| 7 | `5f4955b` | 2026-09-12 15:48 | feat: add FastAPI backend | `main.py`, `requirements.txt`, `test_api.py` |
| 6 | `dcb698e` | 2026-09-12 15:44 | feat: add dependency and call graph analysis | `graphs.py`, `test_graphs.py` |
| 5 | `81ea276` | 2026-09-12 15:38 | feat: implement weighted code search | `search.py`, `test_search.py` |
| 4 | `8e18a18` | 2026-09-12 15:31 | feat: add SQLite storage and project indexer | `database/core.py`, `indexer.py`, `test_indexer.py` |
| 3 | `40120ea` | 2026-09-12 15:23 | feat: implement Python AST parser | `parser.py`, `test_parser.py` |
| 2 | `7c95312` | 2026-09-12 14:46 | feat: implement repository scanner | `scanner.py`, `test_scanner.py`, `sample_projects/sample_shop/` |
| 1 | `ddaaaa4` | 2026-09-12 14:25 | docs: add CodeSeek planning files | `CodeSeek_Plan.md`, `PROJECT_CONTEXT.md` |

Observations (factual):
- 17 of 21 commits were created on a single day (2026-09-12, 14:25–18:32).
- Commit `278f9d2`'s message describes a UI redesign, but the commit also introduces the
  version-history (Milestone 4) and code-intelligence (Milestone 5) backend modules and tests.
  These milestones have **no commit of their own**.
- Several commits include generated or vendored content: `backend/.venv/` (≈2,000 files),
  `node/` and `node.zip` (Node.js runtime, ≈29.6 MB), SQLite files (`codeseek.db`, `test3.db`)
  and ≈25 directories under `backend/uploads/`. **Raw line/file counts from Git therefore
  overstate hand-written code**; use the source-only figures below.

## 4. Author identities visible in Git

`git shortlog -sne --all`:

| Author name | Email | Commits |
|---|---|---|
| `rutuja1903` | `rutujagujar19@gmail.com` | 17 |
| `rutuja1903` | `rutujagujar19` (no domain) | 4 (`e343ac2`, `bbef248`, `bc6176c`, `278f9d2`) |

Committer name is `rutuja1903` on all commits. Only **one** identity appears in history.

## 5. Contribution evidence — what can and cannot be established

**Can be established from Git:** all commits were made from an account/configuration
named `rutuja1903`; their dates, messages and changed files (above).

**Cannot be established from Git (UNKNOWN):**
- The number and names of team members, and each member's individual contribution.
  Pair programming, shared machines, or one member committing on behalf of the team all
  produce the same history. Git authorship alone **does not prove** who designed, wrote,
  tested or documented any part.
- Work done outside the repository (research, UML design, report writing, testing by hand).

**Tool-assisted development (factual evidence that should be disclosed per SPIT policy):**
- `CodeSeek_Plan.md` contains a section "Part E — Antigravity Handoff Prompts"
  (`CodeSeek_Plan.md:162`) with prompts intended for an AI coding assistant.
- The uncommitted Milestone 8 stabilisation changes and the upload error-handling fix
  present in the working tree on 2026-10-31 were produced in a Claude Code (AI assistant)
  session; this evidence pack was also drafted in that session.
- The extent of AI assistance in committed history is **UNKNOWN** from the repository alone.

## 6. Uncommitted working-tree state (2026-10-31)

`git status --short` at audit time:

```
 M .gitignore
 M backend/app/database/core.py
 M backend/app/main.py
 M backend/tests/test_api.py
 M backend/tests/test_graphs.py
 M backend/tests/test_indexer.py
 M backend/tests/test_upload.py
 M frontend/src/App.jsx
 M frontend/src/components/AppShell.jsx
 M frontend/src/utils/format.js
?? README.md
?? backend/tests/conftest.py
?? frontend/src/utils/format.test.js
?? docs/academic/evidence_pack/   (this pack)
```

These changes (upload limits, DB indexes, test isolation, README, error messages) are
**not yet in Git history**. Until they are committed, a reviewer cloning the repository
will not see them, and running the test suite from a clean clone of HEAD is **unsafe**
(see `testing_evidence.md` §2).

## 7. Source-size figures (hand-written code only)

Counted with `wc -l` on 2026-10-31 (working tree, includes blank lines and comments):

| Area | Files | Lines |
|---|---|---|
| Backend application (`backend/app/**/*.py`) | 10 | 3,290 (3,191 at HEAD `278f9d2`) |
| Backend tests (`backend/tests/*.py`, incl. uncommitted `conftest.py`) | 11 | 3,180 |
| Frontend source (`frontend/src/**/*.jsx`, `*.js`, incl. 2 test files) | 21 | 5,338 |
| Frontend CSS (`frontend/src/*.css`) | 2 | 2,090 |

Re-count after committing the working-tree changes, so the report figures match Git.

## 8. Evidence still required from the students

- Team member names, roll numbers and agreed role split.
- Individual contribution statements, ideally cross-referenced to commits or artefacts.
- Meeting logs / weekly progress reports / guide sign-offs.
- Disclosure of AI-assistant usage, if required by the department.
- Whether other repositories, forks or branches exist outside `origin`.
