# CodeSeek — Algorithms and Data Structures (Evidence Pack)

> Complexities in §1–§7 are **theoretically derived** from the code (not measured).
> Numbers in §8 are **experimentally measured**, single runs, on synthetic data, during
> the audit session on 2026-10-31. Line numbers refer to the working tree on that date.

Notation: *F* = number of `.py` files in a project, *B* = total source bytes, *Sy* = symbols,
*I* = import rows, *C* = call rows, *V/E* = graph vertices/edges, *R* = search candidate rows.

## 1. Indexing workflow — `indexer.index_project` (`backend/app/services/indexer.py:13`)

```
init_db (idempotent schema + indexes)
BEGIN (implicit)                      ┐
  delete old rows (same name / same id)│ one SQLite transaction;
  files  = scan_repository(root)       │ any exception → ROLLBACK,
  parsed = parse_repository(files)     │ previous index stays intact
  INSERT files, symbols, imports, calls│
COMMIT                                 ┘
```

- **Time:** O(directory entries) for the scan + O(B) for parsing + O(F + Sy + I + C) inserts.
- **Space:** all parse results are held in memory before insertion: O(B + Sy + I + C).
- **Re-index policy:** every save/restore re-indexes the **whole** project (no incremental indexing).
- **Cascade deletes:** with the `file_id` indexes (`database/core.py:99-113`) deleting a project is
  O(rows · log N). Without them, each deleted file row triggered a full scan of each child
  table: O(F × (Sy + I + C)), i.e. quadratic. Measured effect in §8.2.

## 2. AST parsing and symbol extraction — `backend/app/services/parser.py`

- **Algorithm:** Python's `ast.parse` (`:466`) builds the syntax tree; `_CodeVisitor`
  (`:165`), a subclass of `ast.NodeVisitor`, does a **depth-first traversal**.
- **Data structures:**
  - **Scope stack** (`self._scope_stack`, list of `{"kind", "name", "symbol_id"}`): push on
    entering a `ClassDef`/`FunctionDef`, pop on exit. The top of the stack decides whether a
    function is a `method` (inside a class) or a `nested_function` (inside a function), and
    supplies `parent_id` and the enclosing caller of each `Call`.
  - **Deterministic symbol id**: `"<relative path>::<Outer>.<inner>"` (`_make_symbol_id`, `:68`).
  - Output lists of dicts for symbols, imports and calls.
- **Callee naming** (`_get_callee_name`, `:94`): `Name` → `foo`; an `Attribute` chain is walked to
  `a.b.c`; anything else (subscripts, lambdas) → ignored.
- **Complexity:** O(n) in the number of AST nodes per file (each visited once); O(B) overall.
- **Robustness:** syntax and read errors produce a failure record (`_failure_result`, `:544`)
  rather than an exception, so indexing continues.

## 3. Search — `search.search_project` (`backend/app/services/search.py:10`)

- **Approach:** candidate retrieval with case-insensitive SQL `LIKE '%q%'`, then **additive
  weighted scoring** in Python, deduplicated through a hash map keyed by result identity.

| Match type | Weight |
|---|---|
| exact symbol name | +100 |
| name prefix | +80 |
| name substring | +60 |
| file path | +40 |
| parameter | +30 |
| docstring | +20 |
| symbol/file involved in a matching import or call | +15 |
| raw source contains query | +5 |

- **Ranking:** sort by `(-score, id)`, so ties break deterministically; return the top 50.
- **Complexity:** a leading-wildcard `LIKE` cannot use a B-tree index, so retrieval scans every
  row of the project, including all source text: O(B + Sy + I + C) per query. Scoring is O(R)
  and sorting O(R log R). No inverted index or full-text search (FTS) is used.

## 4. Graph construction and traversal — `backend/app/services/graphs.py`

**Data structure:** `networkx.DiGraph` (adjacency dict-of-dicts).

- **File dependency graph** (`build_file_dependency_graph`, `:49`): a hash map
  `module_name → file` (`path_to_module`, `:15`); each import is resolved by
  `resolve_import_target` (`:30`), trying `module.name` and then `module`. O(F + I).
- **Call graph** (`build_call_graph`, `:111`): a hash map `short name → [symbol ids]`. An edge is
  added only when the callee's last dotted segment matches **exactly one** function or method;
  otherwise the call is listed as unresolved (`ambiguous` / `not found`). O(Sy + C).
  This is name-based static resolution with **no type inference**.
- **Cycle detection** (`graph_to_json`, `:187`): `networkx.simple_cycles` (Johnson's
  algorithm, O((V+E)(c+1)) for *c* elementary cycles). Enumeration stops after 50 cycles
  (`max_cycles`), so the work is bounded by about 51 · O(V+E); cycles of length 1 are
  reported separately as self-loops.
- **Metrics** (`calculate_graph_metrics`, `:236`): node/edge counts, average in- and out-degree,
  and the top-5 in-degree nodes. O(V + E + V log V).
- **Frontend layout** (`frontend/src/components/DependencyGraphs.jsx:38`,
  `computeLayeredPositions`): an iterative DFS gives a topological order of the graph with
  back edges ignored; nodes are placed in layers by dependency depth, left to right
  (`H_GAP = 280`, `V_GAP = 64`, `:32-33`). Back edges are still drawn. O(V + E).

## 5. Code intelligence — `backend/app/services/analysis.py`

- **`ProjectIndex`** (`:66`): exactly four SQL queries load the project; the results are kept in
  hash maps (`symbols`, `functions_by_name`/`classes_by_name` as `defaultdict(list)`,
  `method_names_by_class` as `defaultdict(set)`, `module_to_file`). O(Sy + I + C) time and space.
- **Resolution rule** (`call_candidates`, `:180`): functions by short name first, then classes
  (instantiation). Confidence (`:243`): one candidate → `resolved`, several → `ambiguous`.
- **References / call hierarchy / impact** (`:394`, `:454`, `:481`, `:542`): linear scans
  over the in-memory calls and imports, O(C + I + Sy) per request. Impact is **one hop**
  (direct dependents only).
- **Potentially unused** (`:665`): a regex `[A-Za-z_][A-Za-z0-9_]*` counts identifier occurrences
  over all source (`collections.Counter`), minus definition counts and self-recursive calls; a
  symbol is reported if it has no calls, imports, base-class uses or other mentions, after the
  exclusion rules (`_exclusion_reason`, `:635`; decorator detection `_is_decorated`, `:609`).
  O(B + Sy). Mentions in comments and strings count as uses, which deliberately errs towards
  "used".

## 6. Diff and revert — `frontend/src/utils/lineDiff.js`

- **Algorithm:** strip the common prefix and suffix lines, then run **Myers' O((N+M)·D)
  shortest-edit-script** algorithm (`myersOps`, `:22`; `backtrack`, `:58`) on the middle.
- **Data structures:** `Int32Array` V-vector indexed by diagonal *k*; a `trace` array of
  V-snapshots, one per edit distance *d*, for backtracking: O(D²) memory (comment at `:12-13`).
- **Caps:** `MAX_EDIT_DISTANCE = 1000`, `MAX_MIDDLE_LINES = 20000` (`:14-15`). Beyond them the
  changed region is reported as one simplified hunk, so diff cost stays bounded for huge edits.
- **Hunks:** operations are grouped into `add` / `remove` / `modify` hunks (`hunkKind`, `:89`).
  `revertHunk` (`:188`) splices the saved lines back after checking the hunk still matches
  the buffer (stale hunks are rejected).

## 7. Version history — `backend/app/services/history.py`

- **Storage key:** `<project_id>/<SHA-256(relative_path)>/<version_id>` (`_file_dir`, `:55`). User
  input never becomes a filesystem path component.
- **Version id:** `<16-digit microsecond timestamp>-<12 hex>`, kept strictly increasing even if
  the clock goes backwards (`_new_version_id`, `:178`), so ids sort chronologically as strings.
- **Integrity:** size + SHA-256 are stored in metadata and checked on read (`get_version`, `:157-175`).
- **Atomic write:** temporary file in the same directory → `fsync` → `os.replace` (`atomic_write_bytes`, `:60`).
- **Retention:** keep the newest 10 (`prune_versions`, `:223`). Each operation is O(k + file size),
  with k ≤ 11 metadata files per directory.

## 8. Experimental measurements (audit session, 2026-10-31)

**Conditions:** Windows 11 Home (10.0.26200), Python 3.12.14, one run per measurement, wall
clock (`time.perf_counter`). CPU, RAM and disk type: **UNKNOWN** (not recorded). The data
was **synthetic**. These figures were collected by the AI-assisted audit session; students
should repeat them on their own machine and report the mean of several runs before
quoting them.

**Synthetic project "S800":** 800 files in 40 packages. Each file has 1 import, 12 functions
(each making 2 calls), and 1 class with 1 method: about 52 lines per file, ≈41,600 lines in
total, about 11,200 symbols and ≈20,000 calls.

### 8.1 Pipeline stages (in-process, no HTTP)

| Stage | Time |
|---|---|
| `scan_repository` (800 files) | 0.07 s |
| `parse_repository` | 1.26 s |
| `index_project`, fresh DB | 1.54 s |
| `index_project`, re-index same name (before FK indexes) | 2.82 s |
| ZIP extraction, 800 entries (`extractall` vs per-entry `extract`) | 1.05 s vs 0.98 s |

### 8.2 Effect of foreign-key indexes (DB holding 6 copies of S800)

| Operation | Without indexes | With indexes |
|---|---|---|
| Re-index existing project (as on every save) | 82.15 s | 1.65 s |
| Re-upload with same name | 77.96 s | 1.60 s |
| Build call graph | 0.33 s | 0.19 s |
| Search "func" | 0.40 s | 0.28 s |

### 8.3 HTTP API on a live uvicorn server (S800 uploaded as ZIP, isolated data)

| Request | Time | Response size |
|---|---|---|
| Upload + extract + index | 26.31 s, 10.52 s, 12.61 s (3 runs) | — |
| Project overview | 0.02–0.03 s | <1 KB |
| Search "func" | 0.29–0.30 s | 11 KB |
| File dependency graph | 0.16–0.27 s | 159 KB |
| Function call graph | 1.13–1.21 s | 2,863 KB |
| Stats | 0.36–0.48 s | <1 KB |
| Potentially unused | 0.81–0.90 s | 474 KB |
| References (one function) | 0.33–0.45 s | 1 KB |
| Save one file + full re-index | 4.63 s (before indexes), 3.91 s (after) | — |

The upload time varies widely between runs and is much larger than the in-process
extraction plus indexing time (≈3 s). The cause was **not determined**; filesystem or
antivirus scanning of newly written files is suspected but unconfirmed.

**Not measured (UNKNOWN):** browser rendering time for large graphs, memory usage,
behaviour on real-world open-source projects, and concurrent users.
