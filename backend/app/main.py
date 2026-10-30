"""
main.py -- CodeSeek FastAPI Application

Minimal MVP API wrapping the existing scanner, parser, SQLite indexer,
search, and dependency graph modules.
"""

import os
import json
import uuid
import zipfile
import shutil
import tempfile
import ast
import logging
from fastapi import FastAPI, HTTPException, Path, Query, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

from app.database.core import get_connection
from app.services.indexer import index_project
from app.services.search import search_project
from app.services import history
from app.services import analysis
from app.services.graphs import (
    build_file_dependency_graph, 
    build_call_graph, 
    graph_to_json, 
    calculate_graph_metrics
)

app = FastAPI(
    title="CodeSeek API",
    description="Backend API for local Python project indexing, search, and graph analysis.",
    version="1.0.0"
)

# CORS configuration for future React frontend (assuming local dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"], # React/Vite typical ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------

class AnalyzeRequest(BaseModel):
    name: str
    directory_path: str

# ---------------------------------------------------------
# Endpoints
# ---------------------------------------------------------

@app.post("/projects/analyze")
def analyze_project(req: AnalyzeRequest):
    """
    Index a local Python project.
    """
    if not os.path.isdir(req.directory_path):
        raise HTTPException(status_code=400, detail="Invalid directory path")
        
    try:
        project_id = index_project(req.name, req.directory_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")
        
    return {"message": "Project indexed successfully", "project_id": project_id}


# Base directory where ZIP uploads are extracted.
# Each upload gets its own UUID sub-directory to avoid collisions.
# NOTE (MVP): Extracted directories are not automatically deleted after indexing.
# They are retained so that the File Explorer can still read source content via /files/{id}.
# Manual cleanup of backend/uploads/ is needed periodically.
_UPLOADS_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")

def _extract_and_index_zip(project_name: str, file: UploadFile, update_project_id: Optional[int] = None) -> int:
    """
    Validates, extracts, and indexes an uploaded ZIP file.
    Returns the newly created project_id.
    """
    # --- 1. Validate file extension ---
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted")

    # --- 2. Read uploaded bytes and validate as a real ZIP ---
    try:
        zip_bytes = file.file.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read uploaded file")

    # Write bytes to a temporary file so zipfile can seek through it
    try:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".zip")
        os.close(tmp_fd)
        with open(tmp_path, "wb") as f:
            f.write(zip_bytes)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save uploaded ZIP")

    try:
        if not zipfile.is_zipfile(tmp_path):
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP archive")

        with zipfile.ZipFile(tmp_path, "r") as zf:
            # --- 3. Zip Slip / path traversal check ---
            extract_root = os.path.realpath(
                os.path.join(_UPLOADS_ROOT, str(uuid.uuid4()))
            )
            os.makedirs(extract_root, exist_ok=True)

            for member in zf.infolist():
                # Normalise the member path and check it stays inside extract_root
                member_path = os.path.realpath(
                    os.path.join(extract_root, member.filename)
                )
                if not member_path.startswith(extract_root + os.sep) and member_path != extract_root:
                    # Clean up the already-created directory before raising
                    shutil.rmtree(extract_root, ignore_errors=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Rejected: ZIP entry '{member.filename}' would escape extraction directory (Zip Slip)"
                    )

            # --- 4. Extract ---
            zf.extractall(extract_root)

        # --- 5. Detect single top-level folder ---
        top_level = [
            entry for entry in os.listdir(extract_root)
            if os.path.isdir(os.path.join(extract_root, entry))
        ]
        top_level_files = [
            entry for entry in os.listdir(extract_root)
            if os.path.isfile(os.path.join(extract_root, entry))
        ]
        if len(top_level) == 1 and not top_level_files:
            analyze_dir = os.path.join(extract_root, top_level[0])
        else:
            analyze_dir = extract_root

        # --- 6. Run existing indexing pipeline ---
        try:
            return index_project(project_name, analyze_dir, update_project_id=update_project_id)
        except Exception as e:
            shutil.rmtree(extract_root, ignore_errors=True)
            raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")

    finally:
        # Always remove the temporary raw zip file
        try:
            os.remove(tmp_path)
        except OSError:
            pass


@app.post("/projects/analyze-upload")
def analyze_project_upload(
    name: str = Form(...),
    file: UploadFile = File(...)
):
    """
    Upload a .zip containing a Python repository, extract it safely,
    and index it using the existing pipeline.
    """
    project_id = _extract_and_index_zip(name, file)
    return {"message": "Project indexed successfully", "project_id": project_id}

@app.post("/projects/{project_id}/update-upload")
def update_project_upload(
    project_id: int,
    file: UploadFile = File(...)
):
    """
    Update an existing project by re-uploading a new ZIP.
    Re-indexes the project under the same name and returns the new project_id.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
    project = cursor.fetchone()
    conn.close()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    new_project_id = _extract_and_index_zip(project["name"], file, update_project_id=project_id)
    return {"message": "Project updated successfully", "project_id": new_project_id}


@app.get("/projects/{project_id}")
def get_project_overview(project_id: int):
    """
    Get overview information and counts for a project.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    project = cursor.fetchone()
    
    if not project:
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
        
    cursor.execute("SELECT count(*) as cnt FROM files WHERE project_id = ?", (project_id,))
    file_count = cursor.fetchone()["cnt"]
    
    cursor.execute("SELECT count(*) as cnt FROM symbols WHERE project_id = ?", (project_id,))
    symbol_count = cursor.fetchone()["cnt"]
    
    cursor.execute("SELECT count(*) as cnt FROM imports WHERE project_id = ?", (project_id,))
    import_count = cursor.fetchone()["cnt"]
    
    cursor.execute("SELECT count(*) as cnt FROM calls WHERE project_id = ?", (project_id,))
    call_count = cursor.fetchone()["cnt"]
    
    conn.close()
    
    return {
        "id": project["id"],
        "name": project["name"],
        "root_path": project["root_path"],
        "indexed_at": project["indexed_at"],
        "counts": {
            "files": file_count,
            "symbols": symbol_count,
            "imports": import_count,
            "calls": call_count
        }
    }

@app.get("/projects/{project_id}/files")
def get_project_files(project_id: int):
    """
    Get all indexed files for a project.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
        
    cursor.execute("SELECT id, relative_path, language, line_count, parse_status, parse_error FROM files WHERE project_id = ?", (project_id,))
    files = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return files

@app.get("/files/{file_id}")
def get_individual_file(file_id: int):
    """
    Get detailed information for a specific file, including source code.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM files WHERE id = ?", (file_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
        
    return dict(row)

@app.get("/projects/{project_id}/symbols")
def get_project_symbols(project_id: int, type: Optional[str] = Query(None, description="Filter by symbol type (e.g. function, class)")):
    """
    Get symbols for a project, optionally filtering by type.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
        
    query = "SELECT id, deterministic_id, file_id, name, symbol_type, start_line, end_line, parent_id FROM symbols WHERE project_id = ?"
    params = [project_id]
    
    if type:
        query += " AND symbol_type = ?"
        params.append(type)
        
    cursor.execute(query, params)
    symbols = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return symbols

@app.get("/projects/{project_id}/search")
def search_in_project(project_id: int, q: str = Query(..., min_length=1, description="Search query")):
    """
    Weighted search over project symbols, files, imports, and source code.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    conn.close()
    
    # search_project handles empty queries gracefully
    results = search_project(project_id, q)
    return results

@app.get("/symbols/{symbol_id:path}")
def get_individual_symbol(symbol_id: str = Path(..., description="Deterministic symbol ID. Note: Path parameter allows slashes (e.g., /symbols/app.py::main)")):
    """
    Get detailed information for a specific symbol by its deterministic ID.
    Since deterministic IDs contain '/', '::', and '.', we use a path converter '{symbol_id:path}'
    to ensure FastAPI doesn't truncate the ID or confuse it with a sub-route.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM symbols WHERE deterministic_id = ?", (symbol_id,))
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        raise HTTPException(status_code=404, detail="Symbol not found")
        
    sym = dict(row)
    # Parse JSON fields back to list
    sym["parameters"] = json.loads(sym["parameters"]) if sym["parameters"] else []
    sym["bases"] = json.loads(sym["bases"]) if sym["bases"] else []
    
    return sym

@app.get("/projects/{project_id}/dependencies/files")
def get_file_dependencies(project_id: int):
    """
    Get file dependency graph (imports).
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    conn.close()
    
    G, unresolved = build_file_dependency_graph(project_id)
    return graph_to_json(G, unresolved)

@app.get("/projects/{project_id}/dependencies/functions")
def get_function_calls(project_id: int):
    """
    Get function/method call graph.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    conn.close()
    
    G, unresolved = build_call_graph(project_id)
    return graph_to_json(G, unresolved)

@app.get("/projects/{project_id}/stats")
def get_project_stats(project_id: int):
    """
    Get combined statistics for the project, including graph metrics.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Project not found")
    conn.close()
    
    # Generate graphs to get metrics
    file_G, _ = build_file_dependency_graph(project_id)
    call_G, _ = build_call_graph(project_id)
    
    return {
        "file_dependencies": calculate_graph_metrics(file_G),
        "function_calls": calculate_graph_metrics(call_G)
    }


# ---------------------------------------------------------
# Phase 3: Code Editor Endpoints & Helpers
# ---------------------------------------------------------

class ValidateSourceRequest(BaseModel):
    source: str
    relative_path: Optional[str] = None


class SaveFileRequest(BaseModel):
    relative_path: str
    source: str


def _resolve_and_validate_project_file(conn, project_id: int, relative_path: str):
    """
    Validates that:
    1. The project exists in the database.
    2. relative_path is a relative path (rejects absolute paths, drive letters, UNC paths).
    3. The file exists in the 'files' table for this project_id and ends with '.py'.
    4. The canonical target path is strictly contained within the canonical project root.
    5. Symlinks cannot escape the project root directory.

    Returns:
        tuple[dict, dict, str]: (project_dict, file_dict, canonical_target_path)
    """
    if not relative_path or not isinstance(relative_path, str):
        raise HTTPException(status_code=400, detail="relative_path must be a non-empty string")

    clean_rel = relative_path.strip()
    # Reject absolute paths, UNC paths, and Windows drive specifications
    if os.path.isabs(clean_rel) or clean_rel.startswith(("\\", "/")) or (len(clean_rel) > 1 and clean_rel[1] == ":"):
        raise HTTPException(status_code=400, detail="Invalid path: Absolute paths are not permitted")

    # Only Python files can be edited/saved
    if not clean_rel.lower().endswith(".py"):
        raise HTTPException(status_code=400, detail="Only Python source files (.py) are supported")

    # Verify project exists
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, root_path FROM projects WHERE id = ?", (project_id,))
    project_row = cursor.fetchone()
    if not project_row:
        raise HTTPException(status_code=404, detail="Project not found")
    project = dict(project_row)

    # Standardize separator for DB matching
    db_relative_path = clean_rel.replace("\\", "/")

    # Verify file is indexed in database
    cursor.execute(
        "SELECT id, project_id, relative_path, language, line_count, source, parse_status, parse_error FROM files WHERE project_id = ? AND relative_path = ?",
        (project_id, db_relative_path)
    )
    file_row = cursor.fetchone()
    if not file_row:
        raise HTTPException(status_code=404, detail=f"File '{db_relative_path}' not found in project")
    file_record = dict(file_row)

    # Canonical path containment check on Windows and POSIX
    root_dir = project["root_path"]
    canonical_root = os.path.realpath(os.path.abspath(root_dir))
    target_path = os.path.realpath(os.path.abspath(os.path.join(canonical_root, clean_rel)))

    norm_root = os.path.normcase(canonical_root)
    norm_target = os.path.normcase(target_path)

    try:
        common = os.path.commonpath([norm_root, norm_target])
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied: Path is on a different drive volume")

    if common != norm_root or norm_target == norm_root:
        raise HTTPException(status_code=403, detail="Access denied: Path traverses outside project root")

    return project, file_record, target_path


@app.post("/projects/{project_id}/files/validate")
def validate_project_file_source(project_id: int, req: ValidateSourceRequest):
    """
    Validates Python source code syntax using ast.parse without executing code.
    Confirms project_id exists.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")
    finally:
        conn.close()

    filename = req.relative_path or "<editor>"
    try:
        ast.parse(req.source, filename=filename)
        return {"valid": True, "errors": []}
    except SyntaxError as e:
        error_info = {
            "line": e.lineno,
            "column": e.offset,
            "end_line": getattr(e, "end_lineno", None),
            "end_column": getattr(e, "end_offset", None),
            "message": e.msg,
            "text": e.text.strip() if e.text else None
        }
        return {"valid": False, "errors": [error_info]}
    except Exception:
        return {"valid": False, "errors": [{"line": None, "column": None, "message": "Failed to parse syntax", "text": None}]}


@app.get("/projects/{project_id}/files/by-path")
def get_file_by_relative_path(project_id: int, relative_path: str = Query(..., description="Relative path of file within the project")):
    """
    Get file metadata, source, and attached symbols for a specific relative path within a project.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")

        db_path = relative_path.strip().replace("\\", "/")
        cursor.execute(
            "SELECT id, project_id, relative_path, language, line_count, source, parse_status, parse_error FROM files WHERE project_id = ? AND relative_path = ?",
            (project_id, db_path)
        )
        file_row = cursor.fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail=f"File '{db_path}' not found in project")

        file_data = dict(file_row)

        cursor.execute(
            "SELECT id, deterministic_id, file_id, name, symbol_type, start_line, end_line, parent_id FROM symbols WHERE file_id = ?",
            (file_data["id"],)
        )
        file_data["symbols"] = [dict(s) for s in cursor.fetchall()]

        return file_data
    finally:
        conn.close()


@app.post("/projects/{project_id}/files/save")
def save_project_file(project_id: int, req: SaveFileRequest):
    """
    Safely writes user source code atomically to disk and re-indexes the project.
    If re-indexing fails, returns HTTP 207 Multi-Status with detailed machine-readable diagnostic info.
    """
    conn = get_connection()
    try:
        project, file_record, target_path = _resolve_and_validate_project_file(conn, project_id, req.relative_path)
    finally:
        conn.close()

    # 1. Preserve the current on-disk bytes as a version so this save can be undone.
    #    Without a backup the file is not overwritten.
    try:
        backup = _snapshot_current_file(project_id, file_record["relative_path"], target_path, reason="save")
    except Exception as e:
        logger.error("Version snapshot failed before saving %s: %s", target_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create a backup version; the file was not saved")

    target_dir = os.path.dirname(target_path)
    filename = os.path.basename(target_path)
    temp_path = os.path.join(target_dir, f".{filename}.{uuid.uuid4().hex}.tmp")

    # 2. Atomic file write to disk
    try:
        with open(temp_path, "w", encoding="utf-8") as f:
            f.write(req.source)
            f.flush()
            os.fsync(f.fileno())

        os.replace(temp_path, target_path)
    except Exception as e:
        logger.error("Disk write failed for %s: %s", target_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to save file to disk")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

    # 3. Re-indexing
    clean_rel = req.relative_path.strip().replace("\\", "/")
    return _reindex_after_write(
        project,
        project_id,
        clean_rel,
        messages={
            "reindex_failed": "Source file saved successfully to disk, but re-indexing failed. The AST, symbols, and dependency graphs may be stale until re-indexed.",
            "reindex_missing_file": "Source file saved successfully to disk, but was not found in the project index after re-indexing.",
            "success": "File saved and project re-indexed successfully.",
        },
        extra={"backup_version_id": backup["version_id"] if backup else None},
    )


def _snapshot_current_file(project_id: int, relative_path: str, target_path: str, reason: str):
    """
    Store the file's current on-disk bytes as a history version (exact bytes).
    Returns the version metadata, or None if the file does not exist on disk.
    """
    if not os.path.isfile(target_path):
        return None
    with open(target_path, "rb") as f:
        data = f.read()
    return history.create_snapshot(project_id, relative_path, data, reason=reason)


def _reindex_after_write(project: dict, project_id: int, clean_rel: str, messages: dict, extra: Optional[dict] = None):
    """
    Re-index the project after a successful disk write and build the response:
    HTTP 200 on success, HTTP 207 when the file is on disk but the index could not be
    refreshed (reindex_failed) or the file row is missing afterwards (reindex_missing_file).
    """
    extra = extra or {}
    try:
        index_project(
            project_name=project["name"],
            root_dir=project["root_path"],
            update_project_id=project_id
        )
    except Exception as e:
        logger.error("Re-indexing failed after writing file %s in project %d: %s", clean_rel, project_id, e, exc_info=True)
        return JSONResponse(
            status_code=207,
            content={
                "saved": True,
                "reindexed": False,
                "status": "reindex_failed",
                "message": messages["reindex_failed"],
                "error_type": type(e).__name__,
                "detail": "Parser or indexing error occurred during AST metadata extraction.",
                "project_id": project_id,
                "relative_path": clean_rel,
                "recovery": {
                    "action_required": "manual_reindex_or_resave",
                    "stale_entities": ["symbols", "calls", "dependencies", "file_ids"],
                    "file_persisted_on_disk": True
                },
                **extra,
            }
        )

    # Retrieve new file_id after re-indexing
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM files WHERE project_id = ? AND relative_path = ?",
            (project_id, clean_rel)
        )
        new_row = cursor.fetchone()
        new_file_id = new_row["id"] if new_row else None
    finally:
        conn.close()

    if not new_file_id:
        return JSONResponse(
            status_code=207,
            content={
                "saved": True,
                "reindexed": False,
                "status": "reindex_missing_file",
                "message": messages["reindex_missing_file"],
                "project_id": project_id,
                "relative_path": clean_rel,
                "new_file_id": None,
                "recovery": {
                    "action_required": "manual_reindex",
                    "file_persisted_on_disk": True
                },
                **extra,
            }
        )

    return {
        "saved": True,
        "reindexed": True,
        "status": "success",
        "message": messages["success"],
        "project_id": project_id,
        "relative_path": clean_rel,
        "new_file_id": new_file_id,
        **extra,
    }


# ---------------------------------------------------------
# Milestone 4: File Version History
# ---------------------------------------------------------

class RestoreVersionRequest(BaseModel):
    relative_path: str


def _resolve_history_target(project_id: int, relative_path: str):
    """
    Reuse the editor's project/path validation for history access.
    Returns (project, canonical_relative_path, target_path).
    """
    conn = get_connection()
    try:
        project, file_record, target_path = _resolve_and_validate_project_file(conn, project_id, relative_path)
    finally:
        conn.close()
    return project, file_record["relative_path"], target_path


def _load_version_or_error(project_id: int, relative_path: str, version_id: str):
    try:
        return history.get_version(project_id, relative_path, version_id)
    except history.InvalidVersionId:
        raise HTTPException(status_code=400, detail="Invalid version id")
    except history.VersionNotFound:
        raise HTTPException(status_code=404, detail="Version not found for this file")
    except history.SnapshotCorrupted:
        raise HTTPException(status_code=409, detail="Version data failed its integrity check and cannot be used")


@app.get("/projects/{project_id}/files/versions")
def list_file_versions(project_id: int, relative_path: str = Query(..., description="Relative path of file within the project")):
    """
    List saved versions of a project file, newest first.
    """
    _, rel, _ = _resolve_history_target(project_id, relative_path)
    return {
        "project_id": project_id,
        "relative_path": rel,
        "max_versions": history.MAX_VERSIONS_PER_FILE,
        "versions": history.list_versions(project_id, rel),
    }


@app.get("/projects/{project_id}/files/versions/{version_id}")
def get_file_version(project_id: int, version_id: str, relative_path: str = Query(..., description="Relative path of file within the project")):
    """
    Get one version's metadata and source for preview. The preview text is decoded for
    display; restoring always writes the snapshot's exact bytes.
    """
    _, rel, _ = _resolve_history_target(project_id, relative_path)
    meta, data = _load_version_or_error(project_id, rel, version_id)
    return {**meta, **history.decode_for_display(data)}


@app.post("/projects/{project_id}/files/versions/{version_id}/restore")
def restore_file_version(project_id: int, version_id: str, req: RestoreVersionRequest):
    """
    Restore a saved version: back up the current file as a new version (so the restore
    can be undone), atomically write the snapshot's exact bytes, then re-index.
    Uses the same HTTP 200 / 207 contract as saving.
    """
    project, rel, target_path = _resolve_history_target(project_id, req.relative_path)
    _, data = _load_version_or_error(project_id, rel, version_id)

    try:
        backup = _snapshot_current_file(project_id, rel, target_path, reason="restore")
    except Exception as e:
        logger.error("Version snapshot failed before restoring %s: %s", target_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to back up the current file; nothing was restored")

    try:
        history.atomic_write_bytes(target_path, data)
    except Exception as e:
        logger.error("Disk write failed while restoring %s: %s", target_path, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to write the restored version to disk; the current file is unchanged")

    return _reindex_after_write(
        project,
        project_id,
        rel,
        messages={
            "reindex_failed": "Version restored successfully to disk, but re-indexing failed. The AST, symbols, and dependency graphs may be stale until re-indexed.",
            "reindex_missing_file": "Version restored successfully to disk, but the file was not found in the project index after re-indexing.",
            "success": "Version restored and project re-indexed successfully.",
        },
        extra={
            "restored_version_id": version_id,
            "backup_version_id": backup["version_id"] if backup else None,
        },
    )


# ---------------------------------------------------------
# Milestone 5: Code Intelligence & Impact Analysis
# ---------------------------------------------------------
# Static analysis over the existing index; project code is never executed.
# Symbols are addressed by deterministic_id (stable across re-indexing) via a
# query parameter, because the ids contain '/' and '::'.

_SYMBOL_NOT_FOUND = "Symbol not found in this project. It may have been renamed or removed since the last index."


def _load_project_index(project_id: int) -> "analysis.ProjectIndex":
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Project not found")
    finally:
        conn.close()
    return analysis.ProjectIndex(project_id)


@app.get("/projects/{project_id}/analysis/references")
def get_symbol_references(project_id: int, symbol_id: str = Query(..., min_length=1, description="Deterministic symbol id")):
    """
    Call, instantiation, import and subclass references to a function or class.
    """
    index = _load_project_index(project_id)
    try:
        return analysis.find_references(index, symbol_id)
    except analysis.SymbolNotFound:
        raise HTTPException(status_code=404, detail=_SYMBOL_NOT_FOUND)


@app.get("/projects/{project_id}/analysis/call-hierarchy")
def get_call_hierarchy(project_id: int, symbol_id: str = Query(..., min_length=1, description="Deterministic symbol id")):
    """
    Incoming and outgoing calls for a function or method.
    """
    index = _load_project_index(project_id)
    try:
        return analysis.call_hierarchy(index, symbol_id)
    except analysis.SymbolNotFound:
        raise HTTPException(status_code=404, detail=_SYMBOL_NOT_FOUND)
    except analysis.NotAFunction:
        raise HTTPException(status_code=400, detail="Call hierarchy is only available for functions and methods")


@app.get("/projects/{project_id}/analysis/impact")
def get_symbol_impact(project_id: int, symbol_id: str = Query(..., min_length=1, description="Deterministic symbol id")):
    """
    Direct change impact of a function or class: references, callers, related symbols and files.
    """
    index = _load_project_index(project_id)
    try:
        return analysis.symbol_impact(index, symbol_id)
    except analysis.SymbolNotFound:
        raise HTTPException(status_code=404, detail=_SYMBOL_NOT_FOUND)


@app.get("/projects/{project_id}/analysis/file-impact")
def get_file_impact(project_id: int, relative_path: str = Query(..., min_length=1, description="Relative path of file within the project")):
    """
    Direct change impact of a file: files it imports, files importing it, and cross-file calls.
    """
    index = _load_project_index(project_id)
    try:
        return analysis.file_impact(index, relative_path)
    except analysis.FileNotIndexed:
        raise HTTPException(status_code=404, detail="File not found in this project's index")


@app.get("/projects/{project_id}/analysis/unused")
def get_potentially_unused(project_id: int):
    """
    Functions and classes with no visible use in the project (potentially unused).
    """
    index = _load_project_index(project_id)
    return analysis.potentially_unused(index)



if __name__ == "__main__":
    import uvicorn
    app_dir = os.path.dirname(os.path.abspath(__file__))
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True, reload_dirs=[app_dir])
