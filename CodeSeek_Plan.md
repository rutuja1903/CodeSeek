# CodeSeek — Architecture, Repository Research & Build Plan

---

## Part A — Architecture Validation

**Overall: the architecture is sound and appropriately scoped for a college mini-project.** It maps cleanly onto a classic three-layer design: *scan → parse/index → serve/visualize*. Nothing here is exotic; every piece (ast, SQLite, NetworkX, FastAPI, React) is a standard, well-documented tool with huge amounts of learning material, which matters a lot for a beginner and for viva defense.

**What's technically sound**
- Using `ast` instead of regex for parsing is the right call — it's the only reliable way to get accurate structure, and it's explainable in a viva ("I used Python's own compiler front-end").
- SQLite is the correct database choice: zero-setup, file-based, easy to inspect, and plenty fast for a single-repo, single-user tool.
- NetworkX for graph analysis is appropriate — you get graph algorithms for free (cycles, topological sort, connected components) without writing your own graph engine.
- Separating "extraction" (AST parsing) from "indexing" (SQLite writes) from "querying" (search/graph) is good layering and will make the project much easier to test and explain module by module.
- FastAPI + React is a very common, well-supported stack with tons of tutorials, and it cleanly separates backend logic from UI.

**What's missing or under-specified (small gaps, not architectural flaws)**
1. **Symbol resolution / scoping rules aren't defined yet.** You'll need a simple, explicit policy for: how you generate a unique ID for each symbol (e.g. `path/to/file.py::ClassName.method_name`), and how you resolve a call like `obj.process()` to a specific method (see Part G — this is genuinely the hardest part of the project).
2. **No explicit "unresolved reference" concept.** When code calls a function that isn't defined anywhere in the repo (external library, dynamic dispatch, etc.), you need a defined behavior — store it as an "external/unresolved" node rather than silently dropping it or crashing.
3. **Re-indexing strategy isn't specified.** "Support full repository re-indexing" is listed, but you should decide now: is it a full wipe-and-rebuild of the SQLite DB (simplest, recommended for MVP) or incremental? Full rebuild is far simpler and totally acceptable for a mini-project.
4. **Search ranking needs a concrete scoring formula**, not just an ordered list of match types (see Part G/D) — otherwise "ranking" will be hard to implement and hard to explain in viva.
5. **No mention of a `requirements.txt` / dependency pinning strategy** or a simple test plan — worth adding for "testable" as a stated goal.

**What's unnecessarily complex / should be simplified**
- **React Flow for graph visualization** is a reasonable pick, but for a mini-project you could also get away with a much simpler graph rendering approach (e.g. `vis-network` or even a simple SVG force layout) if React Flow proves to have a learning-curve cost you don't want to pay. This isn't a strong recommendation to change — just flag it as the single UI piece most likely to eat unplanned time.
- Don't build a generic "plugin" system for future languages. You've already correctly scoped this out — just reinforcing it: resist the temptation to make the parser "language-agnostic" via abstraction layers. Write it Python-specific and direct.
- Don't implement your own tokenizer/ranking algorithm from scratch trying to mimic Elasticsearch. A simple weighted-score-by-match-type ranking (Part G) is entirely sufficient and far more explainable than attempting BM25 by hand.

**Do the chosen technologies make sense?**
Yes. This is a well-matched, boring-in-a-good-way stack for a mini-project: nothing here requires you to run new infrastructure, learn a new paradigm, or manage cloud services. That is exactly right for "testable, explainable, not over-engineered."

**Verdict:** Keep the architecture as designed. Add explicit rules for symbol ID generation, unresolved references, re-indexing, and search scoring (these are described concretely in Parts D and G below) — everything else can proceed as planned.

---

## Part B — Repository Analysis

### 1. AnasBabari/RepoDNA
- **Link:** https://github.com/AnasBabari/RepoDNA
- **License:** MIT
- **Overlap with CodeSeek:** High conceptual overlap (parses Python/JS/TS repos into structural maps: files, symbols, imports, dependency/architecture graphs) but almost no *technical* overlap in implementation.
- **Relevant areas:** Architecture-graph concepts, dependency-graph visualization ideas, the idea of a JSON "graph export" schema.
- **Reusable ideas:** The *concept* of a versioned, documented JSON schema for your graph export (`schema/*.schema.json`) is worth copying as a pattern — define your own `codeseek-schema.json` early. The general notion of "layers" (architecture layer, file layer, symbol layer) is also a good mental model.
- **Avoid:** Almost the entire implementation. It's a **Next.js/TypeScript/Vercel** application with GitHub OAuth apps, Upstash Redis rate limiting, PostHog analytics, Neo4j/Parquet exports, and a client/server split designed for a hosted SaaS product. This directly conflicts with your "no cloud, no Docker, no Redis, no Neo4j" constraints.
- **Beginner-friendly?** No — it's a large, production-grade, multi-service codebase with security hardening (ZIP-bomb protection, rate limiting, threat models) that goes far beyond mini-project scope.
- **Best used as:** **Architecture reference only** (for the general idea of layered graph extraction and a documented export schema). Not a backend, parser, search, or UI reference for you.
- **Verdict:** Too large, too cloud-dependent, wrong language for the core engine. Look, don't borrow code.

### 2. cocodedk/codescan
- **Link:** https://github.com/cocodedk/codescan
- **License:** Apache-2.0
- **Overlap with CodeSeek:** Very high. This is the closest match of the five to CodeSeek's actual core engine — a `CodeAnalyzer(ast.NodeVisitor)` that walks Python files and extracts classes, functions, methods, calls, and constants, with file/class/function-level metadata and line numbers.
- **Relevant areas:** Repository scanning (directory traversal, ignore-list handling), AST parsing (`ast.NodeVisitor` subclassing pattern), symbol extraction, function-call extraction, and test-coverage heuristics (naming pattern / import pattern / call pattern — directly useful for your later "which functions are tested" idea if you ever extend statistics).
- **Reusable ideas:** The **node-visitor structure** (visit `ClassDef`, `FunctionDef`, `Call`) is exactly the pattern you should study and adapt. Its handling of "reference nodes" for called-but-undefined functions is precisely the unresolved-call problem described in Part G — study how it creates placeholder nodes and later reconciles them. Its dunder-method skipping and built-in/stdlib call filtering are also directly useful patterns.
- **Avoid:** The **Neo4j dependency** entirely (Docker Compose, Cypher queries, GraSS styling) — swap this concept for SQLite tables/rows instead of graph nodes/relationships. Also skip the **MCP server** component (Cursor IDE integration) — irrelevant to your project.
- **Beginner-friendly?** Yes, relatively — the core `scanner.py`/AST-visitor logic is a single, readable file, which makes it a good *pattern reference* even though the overall repo (Neo4j + MCP server) is more than you need.
- **Best used as: Parser reference** (primary) and secondary **backend reference** for how to structure the visitor + node/relationship model, translated from Neo4j to SQLite.
- **Verdict:** Your single most useful reference repo for the AST-parsing module. Study the `CodeAnalyzer` class closely; do not use Neo4j or the MCP server.

### 3. Raytracer76/IntentGraph
- **Link:** https://github.com/Raytracer76/IntentGraph
- **License:** MIT
- **Overlap with CodeSeek:** High. A PyPI-installable Python tool (`pip install intentgraph`) that performs full-AST analysis of Python (also JS/TS/Go), builds a local **cache** (not a full DB, but conceptually similar), and exposes a **query engine** (`deps`, `dependents`, `context`, `search --has-symbol`, `search --complexity-gt`) very close to what you plan for your search/API layer.
- **Relevant areas:** Symbol extraction, function-level dependency extraction, and especially **query design** — its CLI (`query context`, `query deps`, `query dependents`, `query path`, `query search`) is a genuinely good model for designing your own FastAPI search/query endpoints.
- **Reusable ideas:** The **separation of `RepositoryAnalyzer` (produces a result object) from `QueryEngine` (answers questions about that result)** is an excellent architectural pattern to copy directly — it maps cleanly onto your own "indexer" vs "search" module split. The idea of **deterministic, SHA256-derived stable IDs** for files/symbols (`RepoSnapshotBuilder`) is a strong pattern for your symbol-ID scheme (Part D/G).
- **Avoid:** The multi-language abstraction layers (JS/TS/Go support), the `ai/` natural-language query module (explicitly out of scope per your constraints), and its packaging as a pip-installable CLI tool (you need a web app, not a CLI).
- **Beginner-friendly?** Moderately — code quality is high (90% coverage, strict mypy) which makes it pleasant to *read*, though the multi-language abstraction adds complexity you don't need to look at.
- **Best used as: Architecture reference** (Analyzer/QueryEngine split) and **search/query reference** (its CLI query vocabulary is a good starting point for your own API design).
- **Verdict:** Don't fork it or install it as a dependency — read `RepositoryAnalyzer` and `QueryEngine` for architectural inspiration only.

### 4. stefmolin/ast-explore
- **Link:** https://github.com/stefmolin/ast-explore
- **License:** Apache-2.0
- **Overlap with CodeSeek:** Narrow but extremely useful overlap — it's a small, focused **AST visualization/teaching tool**, not a code-intelligence platform. It walks the AST of a single Python file and pretty-prints every node with source location, docstring, and fields, with an `--interactive` step-through mode.
- **Relevant areas:** Pure **AST parsing/traversal** — nothing about scanning, indexing, search, or graphs.
- **Reusable ideas:** This is your **best learning tool**, not a code-reuse target. Running it against your own test files while you build your AST parser module will show you exactly what fields (`lineno`, `end_lineno`, `col_offset`, docstrings, node-specific fields) are available on each node type — this directly de-risks "Part F — learning plan" for the AST module. Its `--types`/`--skip` filtering pattern is a nice small idea for debugging your own visitor.
- **Avoid:** Nothing to avoid — there's nothing here incompatible with your goals; it's just narrow in scope (a single-file exploration CLI, no persistence, no search, no server).
- **Beginner-friendly?** Very. This is the most beginner-friendly repo of the five.
- **Best used as: Parser reference** — specifically as a *debugging/learning companion tool* you can literally `pip install` and run on your own test fixtures while building the real parser, rather than something you adapt code from.
- **Verdict:** Install it as a personal debugging aid throughout the "AST parser" module. Do not try to build CodeSeek's core on top of it — it solves a different problem (human exploration) than yours (structured indexing).

### 5. ArchiCore-Team/archicore
- **Link:** https://github.com/ArchiCore-Team/archicore
- **License:** MIT
- **Overlap with CodeSeek:** Conceptually broad overlap (dependency graphs, BM25 search, impact analysis, multi-format export) but built on an entirely different stack.
- **Relevant areas:** Its **feature list** is a good checklist to compare CodeSeek against (dependency graph, search, impact/"blast radius" analysis, metrics) and its **BM25 search description** ("full-text search with camelCase/snake_case tokenization and graph-boosted ranking") is a good conceptual reference for your own ranked search design.
- **Reusable ideas:** The *idea* of graph-boosted ranking (structural matches ranked above plain text matches) directly matches your own planned ranking order in Part G. Worth reading about, not copying code for.
- **Avoid:** The entire implementation — it's **TypeScript**, uses **tree-sitter** (not Python `ast`), supports 40+ languages via a generic parser abstraction, ships an optional **Neo4j** backend, a **REST server**, a **GitHub Action**, and optional **LLM plugins** (Ollama/OpenAI) for explanations — every one of these conflicts with your stated constraints (Python-only, no Neo4j, no Docker/K8s implied by its Action-based distribution, no AI/LLM features for MVP).
- **Beginner-friendly?** No — it's a mature, multi-language static-analysis platform with security scanning, dead-code detection, and duplication analysis; well beyond mini-project scope and in the wrong language for you to read comfortably if you're a Python beginner.
- **Best used as: Architecture reference only** — specifically for its feature checklist and its written description of graph-boosted BM25 ranking.
- **Verdict:** Interesting to skim for ideas about ranking and impact analysis; not usable as code, not beginner-friendly, wrong language.

### Additional repository (beyond the required 5)

I looked for repos closer to CodeSeek's *actual* stack (pure Python `ast`, SQLite, no external parser libraries, no cloud) and found one clearly worth adding:

### 6. virobit/quickast
- **Link:** https://github.com/virobit/quickast (also on PyPI as `quickast`)
- **License:** MIT
- **Why it's more relevant than most of the required five:** It is, almost feature-for-feature, a smaller sibling of CodeSeek's core engine — it explicitly states it uses **"no external parsing libraries — QuickAST uses Python's built-in `ast` module for Python files"**, and it builds a **SQLite index** of every symbol, call relationship, and import, with a CLI to query it (`quickast query <symbol>`, `callers-of`, `callees`, `impact`).
- **Relevant areas:** Repository scanning, pure-`ast` symbol/call/import extraction, SQLite schema design, incremental re-indexing via file watching (you can ignore the watching part, but the schema and query commands are directly relevant), and a working example of `caller`/`callee`/`impact` (transitive dependency) queries — essentially your function-call graph, without NetworkX.
- **Reusable ideas:** Its SQLite-first, no-external-dependency philosophy is the single closest match to what your project should look like internally. Use it to sanity-check your own schema design (what columns/tables does it use for symbols, calls, imports?) and your own query vocabulary.
- **Avoid:** Its CLI-only interface (you need a web API/UI) and its JS/Markdown support (out of scope for you).
- **Beginner-friendly?** Yes — small, single-purpose, readable.
- **Best used as: Backend reference** and **parser reference**, arguably tied with `codescan` as your most directly useful repo — the two together (codescan's AST-visitor pattern + quickast's SQLite-native schema/query philosophy) essentially sketch out your entire backend.

I stopped at one addition rather than adding up to three — the five required repos plus this one already give solid coverage of every area you asked about (parser, backend, search, architecture, and a pure learning tool), and adding more would mean more reading time without materially better coverage.

---

## Part C — How You Should Reuse These Repos

| Option | Beginner fit | Mini-project fit | Viva explainability | Implementation speed | Architecture cleanliness |
|---|---|---|---|---|---|
| **A. Build from scratch, repos as reference only** | Best — you understand every line | Best — matches "understandable, testable" goal | Best — you can explain any part | Slower at first, but no time lost untangling someone else's code | Best — architecture stays exactly what you designed |
| **B. Build yourself, adapt selected patterns/snippets** | Good, if you understand what you adapt | Good | Good, as long as you can explain *why* you structured things that way | Faster than A, since you skip some trial-and-error | Good, if adaptation is deliberate and modular |
| **C. Fork one lightweight repo and modify it** | Risky — inherited code you didn't design is hard to defend in viva | Poor fit — grading typically expects your own design/implementation, and a fork blurs authorship | Weakest — "why does this file exist" answers become "it came with the fork" | Fastest short-term, but risky long-term (fighting someone else's assumptions) | Weakest — you inherit their abstractions, naming, and structure whether or not they fit your plan |

**Recommendation: Option B — build CodeSeek yourself, module by module, consciously adapting specific patterns from `codescan` (AST visitor structure, reference-node handling for unresolved calls) and `quickast` (SQLite schema/query philosophy), while treating `ast-explore` as a live debugging tool and the other three as read-only architecture references.**

**Why this is best for you specifically:**
- **Beginner:** You still write and understand every line that ends up in your repo — nothing "just works" without you knowing why.
- **Mini-project:** Graders and viva panels expect original implementation; Option B gives you 100% authorship while still learning from proven patterns instead of reinventing every wheel from zero.
- **Viva explainability:** You can honestly say "I designed this schema myself, but the idea of a placeholder node for unresolved calls is a known pattern I studied in `codescan`" — that's a strong, defensible answer. A fork ("I started from repo X") is a much weaker answer to "why is your code structured this way?"
- **Implementation speed:** Full from-scratch (Option A) risks you rediscovering solved problems (e.g., how to represent an unresolved call) slowly. Adapting a *pattern* (not code) from a reference repo saves real time without costing you understanding.
- **Clean architecture:** Because you're writing the code yourself against your own schema, nothing forces your database design or module boundaries to match someone else's assumptions (e.g., you're not stuck bolting SQLite logic onto a design that assumed Neo4j).

**License note:** Since you're following Option B (studying patterns, not copying code), license compliance is simple: you don't need to include any third-party license text or attribution in your own repo, because you aren't redistributing their code. If at any point you copy even a small recognizable snippet (e.g., a specific regex or a specific SQL statement) verbatim from `codescan` (Apache-2.0) or `quickast` (MIT), both licenses permit this for a student project as long as you keep the original copyright/license notice for that portion and, for Apache-2.0, note if you changed the file. Simplest safe rule: **don't copy-paste code blocks — write your own version after understanding theirs.** That keeps you licence-clean automatically and is also better for your own learning and viva.

---

## Part D — Reuse Map

| CodeSeek Part | Best Reference Repo | What to Learn/Borrow | What NOT to Copy |
|---|---|---|---|
| **Scanner** (recursive `.py` discovery, ignore-list) | `cocodedk/codescan` | Configurable directory skip-list pattern (skip `.git`, venvs, `node_modules`); storing paths relative to project root for portability | Its `.env`-driven Neo4j connection config — replace with a simple SQLite file path |
| **Parser** (`ast.NodeVisitor` over files) | `cocodedk/codescan` (primary), `stefmolin/ast-explore` (learning tool) | The `CodeAnalyzer(ast.NodeVisitor)` pattern: visiting `ClassDef`/`FunctionDef`/`Call` nodes; dunder-method skipping; filtering stdlib/builtin calls out of the call graph | Its Neo4j node/label creation calls — replace with SQLite `INSERT` statements |
| **Symbol extraction** (name, type, file, line range, parent, params, docstring, snippet) | `cocodedk/codescan`, `Raytracer76/IntentGraph` | codescan's property set per node type (`name`, `file`, `line`, `end_line`); IntentGraph's idea of deterministic, stable symbol IDs (so re-indexing produces consistent IDs) | IntentGraph's multi-language abstraction layer — you only need the Python-specific path |
| **Function-call graph / call extraction** | `cocodedk/codescan` (reference-node pattern), `virobit/quickast` (caller/callee/impact query design) | codescan's "reference node" pattern for calls to undefined functions, redirected once the real function is found; quickast's `callers-of` / `callees` / `impact` (transitive) query shapes | codescan's Cypher-specific relationship model — translate `CALLS` relationships into a SQLite `calls` table with `caller_id`, `callee_id`, `line`, `resolved` columns |
| **File dependency graph (imports)** | `virobit/quickast` | Its import-extraction approach and how it distinguishes internal vs external imports | N/A — nothing to avoid here, it's a small, clean piece |
| **Indexing / SQLite schema & search** | `virobit/quickast` (schema/query philosophy), `ArchiCore-Team/archicore` (ranking concept only, read-only) | quickast's principle of "no external parsing libs, SQLite is the single source of truth, queries return in milliseconds"; ArchiCore's *description* of graph-boosted ranking (structural matches first, then text) as a model for your scoring formula | ArchiCore's actual BM25/tree-sitter implementation — build your own simple weighted scoring instead (see ranking formula below) |
| **Dependency graph analysis (NetworkX)** | None of the five directly (all use Neo4j/custom graph structures instead of NetworkX) | Read NetworkX's own docs/tutorials instead — `networkx.DiGraph`, `nx.simple_cycles()`, `nx.ancestors()`/`nx.descendants()` for "who depends on this" / "what does this depend on" | — |
| **UI / Dashboard / graph visualization** | `AnasBabari/RepoDNA` (read-only, screenshots + concept), `ArchiCore-Team/archicore` (feature checklist) | The general idea of separate views for Overview / Architecture Map / Dependencies (RepoDNA's screenshot layout is a reasonable template for your own Dashboard, File Explorer, Class Explorer, Graph screens) | RepoDNA's actual Next.js/Vercel frontend code — you're using plain React + React Flow, a very different stack |
| **Repository statistics** | `cocodedk/codescan` (its "statistics collection" feature) | The idea of collecting counts (files, functions, classes, calls, LOC) during the same scan pass rather than as a separate expensive query | — |

**A concrete, explainable search ranking formula** (fills the Part A gap — give each result a numeric score, then sort descending):

```
score = 0
if exact symbol name match:      score += 100
elif prefix match:               score += 80
elif partial/substring match:    score += 60
if file name/path match:         score += 40
if parameter name match:         score += 30
if docstring match:              score += 20
if import/call match:            score += 15
if raw source-code match:        score += 5
```
This is simple, explainable in five minutes to a viva panel, and matches your stated ranking order exactly.

---

## Part E — Antigravity Handoff Prompts

### Prompt 1 — Opening the existing CodeSeek project and reading context
```
You are joining an existing college mini-project called CodeSeek, already partially
planned outside this IDE. Before writing or changing anything:

1. Open and read every file currently in this workspace (do not assume it is empty).
2. Read any README, ARCHITECTURE.md, or planning notes present in the repo.
3. Summarize back to me: current folder structure, what modules exist so far,
   what is implemented vs. stubbed, and what tech stack is in use.
4. Do NOT create new files, do NOT install new dependencies, and do NOT restructure
   folders yet. This is a read-only context-gathering step.
5. Ask me before assuming anything about missing pieces.

Wait for my confirmation of your summary before doing any further work.
```

### Prompt 2 — Cloning/inspecting the selected reference repositories
```
I want you to clone (or fetch, read-only) the following reference repositories into
a separate, clearly-named folder such as /reference-repos (outside my actual
CodeSeek source tree, never merged into it):

- https://github.com/cocodedk/codescan
- https://github.com/virobit/quickast
- https://github.com/stefmolin/ast-explore

For each one:
1. Locate the core parsing/indexing logic file(s).
2. Summarize, in plain English, how each one walks the AST or builds its index —
   do not paste large code blocks, describe the approach.
3. Do NOT copy any code from these repos directly into my CodeSeek project files.
4. Do NOT add these repos as dependencies or git submodules of my project.
5. Confirm the license of each repo you inspect before summarizing (codescan is
   Apache-2.0, quickast and ast-explore's license should be verified from their
   LICENSE files) and tell me if anything in the license would restrict how I use
   the ideas.

This is a research/learning step only. Wait for my go-ahead before starting any
actual CodeSeek implementation.
```

### Prompt 3 — Starting only the first implementation module
```
We are implementing CodeSeek module by module, in this order: project setup,
repository scanner, AST parser, parser testing, SQLite schema, indexer, search,
dependency analysis, FastAPI endpoints, React frontend, integration, re-indexing/polish.

Right now, implement ONLY the first module: project setup and the repository
scanner (recursive discovery of .py files inside an extracted ZIP, with a
configurable ignore-list for venvs/.git/node_modules/__pycache__).

Constraints:
1. Do NOT implement the AST parser, database, or any later module yet, even
   partially — stop once the scanner module and its tests are done.
2. Do NOT add any dependency beyond what's already agreed (Python stdlib,
   FastAPI, SQLite, NetworkX, and their direct requirements) without asking me
   first and explaining why it's needed.
3. Do NOT introduce any AI/LLM calls, embeddings, or external APIs.
4. Explain each function you write in a short comment, since I'm a beginner and
   need to understand this code, not just have it work.
5. Write at least a basic test for the scanner (e.g., using a small sample
   directory with nested folders and an ignored venv folder) before considering
   this module done.

Stop and summarize what you built when this module is complete. Do not proceed
to the next module without my explicit approval.
```

### Prompt 4 — Reusable template for every future module
```
We are now implementing the next CodeSeek module: [MODULE NAME].

Before starting:
1. Read the existing code you've already written for previous modules — do not
   re-derive interfaces from scratch if they already exist.
2. Confirm your understanding of what this module needs to do, in 3-5 bullet
   points, before writing code.

While implementing:
3. Implement ONLY this module. Do not start on later modules in the sequence
   (project setup, scanner, AST parser, parser testing, SQLite schema, indexer,
   search, dependency analysis, FastAPI endpoints, React frontend, integration,
   re-indexing/polish), even if it seems efficient to combine steps.
4. Do NOT change the existing architecture, database schema, or module
   boundaries we've already agreed on, without first explaining the proposed
   change and getting my explicit approval.
5. Do NOT add any new dependency, framework, or library without asking first
   and explaining why the existing stack isn't sufficient.
6. Do NOT introduce AI/LLM features, embeddings, or vector search.
7. Do NOT copy code verbatim from any external repository — write original
   code, even if inspired by a pattern we discussed.
8. Do NOT rewrite or refactor working code from earlier modules unless I
   explicitly ask you to — if you notice something that could be improved,
   tell me instead of changing it.
9. Add a short comment above non-trivial functions explaining what they do
   and why, since I need to understand and explain this code myself.
10. Write or update tests relevant to this module before considering it done.

When finished, summarize what changed, list any new files, and stop for my
review before moving to the next module.
```

---

## Part F — Learning Plan (practical, stage-by-stage)

**Repository scanner**
- Understand: `os.walk` / `pathlib.Path.rglob`, what "recursive traversal" means, why you need an ignore-list (venvs, `.git`, `__pycache__`, `node_modules` if any JS sneaks in), and the difference between absolute and relative paths (store relative — it's what makes your database portable across machines).
- Skip for now: anything about file-system watching or incremental updates — full re-scan is fine for MVP.

**Python AST parser**
- Understand: what an AST is conceptually (a tree representation of code structure, produced by `ast.parse()`); the `ast.NodeVisitor` pattern (`visit_FunctionDef`, `visit_ClassDef`, `visit_Call`); the difference between a function's `lineno`/`end_lineno` and its `col_offset`; how to detect whether a `FunctionDef` is a method (its parent node is a `ClassDef`) vs a standalone function; how `ast.get_docstring()` works.
- Practical tip: install and run `ast-explore` on a few of your own test files early — seeing the raw node structure will save you hours of guessing.
- Skip for now: type inference, control-flow analysis, or anything beyond structural extraction.

**SQLite / indexing**
- Understand: how to design normalized tables (`files`, `symbols`, `calls`, `imports`), primary/foreign keys, and why you commit in batches rather than row-by-row for performance; how to open a fresh connection per request in FastAPI (or use a simple connection pool) rather than sharing one global connection unsafely.
- Skip for now: SQLite full-text search (FTS5) — a simple `LIKE '%term%'` plus your own scoring in Python is enough for MVP and much easier to explain.

**Search ranking**
- Understand: the scoring-by-match-type approach in Part D — this is a small amount of Python (compute a score per match type, sum, sort). You do not need to understand TF-IDF or BM25 to build a defensible ranked search for this project.
- Skip for now: any real information-retrieval theory beyond "give better matches a higher number."

**NetworkX dependency graphs**
- Understand: how to build a `nx.DiGraph()`, add nodes/edges, and run the handful of functions you actually need: `nx.simple_cycles()` (circular imports), `nx.ancestors()`/`nx.descendants()` (who depends on / is depended on by a node), and basic centrality if you want a "most-connected" statistic.
- Skip for now: graph layout algorithms — that's React Flow's/frontend's job, not NetworkX's.

**FastAPI**
- Understand: path operations (`@app.get`, `@app.post`), Pydantic models for request/response validation, file upload handling (`UploadFile`) for your ZIP endpoint, and how to return JSON your React frontend can consume; CORS setup (you'll need it since frontend and backend run on different ports locally).
- Skip for now: authentication, background task queues, or async database drivers — synchronous SQLite calls are fine at this scale.

**React**
- Understand: components, `useState`/`useEffect` for fetching data from your FastAPI backend, basic routing between your planned screens (Home, Dashboard, Search, Explorers, Graphs, Statistics), and how to pass data down as props to a table/list/graph component.
- Skip for now: global state managers (Redux, Zustand) — for this scope, component state and prop-drilling (or at most React Context) is enough.

---

## Part G — Risks and Technical Traps

| Risk | Simplest reasonable MVP behavior |
|---|---|
| **Duplicate function/method names** (same name in different files/classes) | Never key anything by name alone. Every symbol gets a unique ID like `path/to/file.py::ClassName.method_name` (or `path::function_name` for module-level). Search can still match by plain name, but storage/graph edges always use the full ID. |
| **Methods vs. functions** | During AST traversal, track the current class context (a simple stack). If a `FunctionDef` is visited while inside a `ClassDef`, tag it as a method with a `parent_class` field; otherwise tag it as a standalone function. |
| **Nested functions** (a function defined inside another function) | Treat them as symbols too, with a `parent_symbol` reference (which can be a function ID, not just a class ID). For MVP, it's fine to still show them in the Function Explorer with a small "nested in X" indicator rather than building a separate UI concept. |
| **Broken/invalid Python syntax** (file doesn't parse) | Wrap `ast.parse()` in a try/except `SyntaxError`. Log the file as "failed to parse" with the error message, skip it, and continue scanning the rest of the repository. Show a count of "N files skipped due to syntax errors" in your Statistics screen — this is honest and easy to explain. |
| **External vs internal imports** | When resolving an `import` statement, first check if it matches a `.py` file that exists inside the scanned repo. If yes, it's internal (create a File→File dependency edge). If no, mark it as external (store the import name, but don't try to resolve or graph it further). |
| **Ambiguous function calls** (`obj.process()` — which `process` is it?) | Do NOT attempt full type inference for MVP (this is a genuinely hard problem, even for production tools). Simplest honest approach: resolve by name-matching against methods with that name across the repo. If there's exactly one method named `process` in the repo, link to it with high confidence. If there are multiple, link to a generic "ambiguous call" placeholder listing all candidates, and say so explicitly in the UI (e.g., "3 possible targets"). This is a fair, explainable MVP simplification — say this directly in your viva as a known, deliberate limitation. |
| **Built-in functions appearing in call graphs** (`print()`, `len()`, `str()` cluttering the graph) | Maintain a simple filter list (Python's `dir(builtins)`) and exclude calls to builtins from the call graph by default. Optionally let the user toggle "show built-in calls" in the UI, but default to hidden — this keeps the graph readable. |
| **Large repositories** (thousands of files) | Set a sane MVP limit (e.g., reject ZIPs with more than ~2,000 Python files, or more than ~50MB extracted) with a clear error message, rather than trying to handle arbitrarily large repos. Mention this as a known scope limit, not a bug. |
| **Search-result noise** (too many low-relevance matches) | Apply the scoring formula from Part D, then simply cap results returned (e.g., top 50) with a "showing top 50 of N matches, refine your search" message rather than trying to build pagination for MVP. |
| **Stale index after code changes** (user edits the repo, index doesn't match) | For MVP, don't attempt automatic change detection. Provide an explicit "Re-index" button that wipes and rebuilds the SQLite tables for that repo from a fresh ZIP upload. This is simple, safe, and easy to explain ("we chose explicit re-indexing over file-watching for simplicity and reliability in a college project"). |

---

## Part H — Final Recommendation

### 1. Final recommended CodeSeek architecture
Keep the architecture exactly as you designed it, with these concrete additions locked in before you start coding:
- **Symbol ID scheme:** `relative/file/path.py::ClassName.method_name` (or `::function_name` for module-level functions), unique per symbol, generated deterministically so re-indexing produces the same IDs.
- **Unresolved/external references:** stored as their own row type (`is_external = true` / `is_unresolved = true`) rather than dropped — this keeps your graphs honest and gives you an easy "external dependencies" statistic for free.
- **Re-indexing:** full wipe-and-rebuild per repository upload, triggered by an explicit "Re-index" action. No file-watching or incremental diffing for MVP.
- **Search ranking:** the fixed weighted-scoring formula from Part D — simple, explainable, matches your stated ranking order exactly.
- **Ambiguous-call handling:** name-based resolution with an explicit "ambiguous" state when multiple candidates exist, rather than attempting type inference.

### 2. Best reference repositories and their roles
| Repo | Role |
|---|---|
| `cocodedk/codescan` | Primary parser/backend pattern reference (AST visitor, reference-node handling for unresolved calls) |
| `virobit/quickast` | Primary SQLite schema/query philosophy reference (pure-`ast`, no external libs, query vocabulary) |
| `stefmolin/ast-explore` | Live debugging/learning tool — install and run it on your own test files throughout the parser module |
| `Raytracer76/IntentGraph` | Architecture reference for Analyzer/QueryEngine separation and stable symbol IDs |
| `ArchiCore-Team/archicore` | Read-only reference for ranking concepts and a good "feature checklist" to compare CodeSeek against |
| `AnasBabari/RepoDNA` | Read-only reference for UI layout ideas (Overview/Architecture/Dependencies screens) and the idea of a documented JSON export schema |

### 3. What CodeSeek should borrow vs. build itself
**Borrow (as patterns, not code):** the AST-visitor structure; the "reference/placeholder node" trick for unresolved calls; a SQLite-first, no-external-parsing-library philosophy; a simple query-engine layer separate from the analyzer; the idea of a documented, versioned export schema.

**Build entirely yourselves:** the SQLite schema itself (designed for your exact fields — parameters, docstrings, snippets, inheritance); the ranking/scoring formula; the FastAPI endpoints and their contracts with React; the entire React frontend (Explorers, Dashboard, Graph views); the re-indexing flow; the ZIP-upload and extraction handling; all tests.

### 4. What to do next, in exact order
1. Lock in the four architectural additions above (symbol ID scheme, unresolved-reference handling, re-indexing policy, ranking formula) as a one-page decision doc you can show in your viva.
2. Set up the project skeleton (folders for backend/frontend, `requirements.txt`, `package.json`, git repo, basic FastAPI "hello world" endpoint and React "hello world" page) — confirm the two can talk to each other (CORS working) before writing any real logic.
3. Build and test the **repository scanner** module in isolation (input: path to extracted ZIP; output: list of `.py` file paths, ignore-list respected) with a couple of sample test folders including a fake venv to skip.
4. Install `ast-explore` and spend an hour exploring the AST of a few real Python files you intend to use as test fixtures — this will make the next step much easier.
5. Build the **AST parser** module: a visitor class producing plain Python objects/dicts for files, classes, functions, methods, params, docstrings, calls, and imports — test it thoroughly against small, hand-written sample files where you know the exact expected output before running it on real repos.
6. Design and create the **SQLite schema**, then write the **indexer** that takes parser output and writes it to the database, including the unresolved-reference handling from Part G.
7. Build the **search/query layer** in plain Python functions first (test them directly against the SQLite DB, no API yet) using the scoring formula.
8. Build the **dependency analysis** layer with NetworkX on top of your `imports`/`calls` tables (file graph, call graph, cycle detection).
9. Wrap steps 3–8 in **FastAPI endpoints** (upload, scan-status, search, file/function/class explorers, graphs, statistics, re-index).
10. Build the **React frontend** screen by screen, starting with Upload → Progress → Dashboard, then Search, then the three Explorers, then the two Graphs, then Statistics.
11. Do **integration testing** end-to-end with a real (small) public GitHub repo's ZIP download, fix mismatches between backend output and what the frontend expects.
12. Polish: re-indexing flow, error states (bad ZIP, unparseable files, empty repo), and a short README documenting your architecture decisions for submission/viva.

---

*Use this document as your working reference throughout the build. When you move to Antigravity, paste the relevant prompt from Part E at the start of each module, and keep this file open alongside it so Antigravity (and you) stay anchored to the agreed scope.*
