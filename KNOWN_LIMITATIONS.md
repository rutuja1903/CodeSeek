# CodeSeek MVP Known Limitations

The current MVP of CodeSeek is a stable local desktop application, but it operates under several intentional limitations. Future versions may address these boundaries.

## Language Support
- **Python Only**: The scanner, parser (using `ast`), and indexing pipeline are strictly built for Python source code. Other languages are ignored.

## Analysis Capabilities
- **Static Analysis Only**: CodeSeek relies entirely on static AST parsing. Dynamic runtime behavior, reflection, and deeply nested dynamic scopes are not tracked.
- **Unresolved Ambiguous Calls**: Method calls that cannot be deterministically mapped back to a specific class or module definition at parse time (due to dynamic typing or complex inheritance) remain unresolved in the Call Graph.

## Storage and Infrastructure
- **Persistent ZIP Extractions**: When a repository ZIP is uploaded, the backend extracts it to a local `uploads/` directory with a UUID. Currently, these extractions persist indefinitely so that the File Explorer can access source code snippets on demand. Manual cleanup of the `backend/uploads/` folder is required.
- **Local SQLite DB**: The indexer relies on a simple, locally stored SQLite database (`codeseek.db`). It is not optimized for massive enterprise monorepos or distributed querying.

## Features Excluded from MVP
- **No Incremental Indexing**: Updating a project performs a complete wipe-and-rebuild of the project's data. File watchers and incremental indexers are not implemented.
- **No Semantic AI Search**: Search is performed using SQL LIKE statements and deterministic string matching with ranking heuristics. Vector-based embeddings and AI semantics are excluded.
- **No GitHub Integration**: Users must manually upload `.zip` archives. There is no OAuth or GitHub API pulling.
- **No Authentication**: The application is intended for local dev use. It has no user accounts, RBAC, or cloud-deployment safety measures.
