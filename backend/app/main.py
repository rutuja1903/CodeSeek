"""
main.py -- CodeSeek FastAPI Application

Minimal MVP API wrapping the existing scanner, parser, SQLite indexer,
search, and dependency graph modules.
"""

import os
import json
from fastapi import FastAPI, HTTPException, Path, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from app.database.core import get_connection
from app.services.indexer import index_project
from app.services.search import search_project
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
