"""
search.py -- CodeSeek Search Module

Implements a deterministic, keyword-based search over the SQLite index.
Applies weighted scoring for structural matches vs text matches.
"""

from app.database.core import get_connection

def search_project(project_id: int, query: str, db_path: str = "codeseek.db", limit: int = 50):
    """
    Search the indexed database for the given query.
    
    Ranking system:
    - exact symbol name match: +100
    - symbol name prefix match: +80
    - symbol name substring match: +60
    - filename/path match: +40
    - parameter match: +30
    - docstring match: +20
    - import/call match: +15
    - raw source match: +5
    
    Returns a sorted list of top results (up to limit).
    """
    query_str = query.strip()
    if not query_str:
        return []
        
    query_lower = query_str.lower()
    like_query = f"%{query_lower}%"
    
    conn = get_connection(db_path)
    cursor = conn.cursor()
    
    # Pre-fetch file paths for this project to resolve file_ids later
    cursor.execute("SELECT id, relative_path FROM files WHERE project_id = ?", (project_id,))
    file_map = {row["id"]: row["relative_path"] for row in cursor.fetchall()}
    
    if not file_map:
        conn.close()
        return [] # Project not found or has no files
        
    results_map = {} # Maps unique keys to result dictionaries
    
    def get_symbol_entry(sym_row):
        key = f"symbol:{sym_row['deterministic_id']}"
        if key not in results_map:
            results_map[key] = {
                "id": sym_row["deterministic_id"],
                "type": "symbol",
                "name": sym_row["name"],
                "symbol_type": sym_row["symbol_type"],
                "relative_path": file_map.get(sym_row["file_id"], ""),
                "start_line": sym_row["start_line"],
                "end_line": sym_row["end_line"],
                "parent_id": sym_row["parent_id"],
                "score": 0,
                "reasons": set()
            }
        return results_map[key]

    def get_file_entry(file_row):
        key = f"file:{file_row['id']}"
        if key not in results_map:
            results_map[key] = {
                "id": f"file_{file_row['id']}",
                "type": "file",
                "name": file_row["relative_path"],
                "symbol_type": "file",
                "relative_path": file_row["relative_path"],
                "start_line": 1,
                "end_line": file_row["line_count"],
                "parent_id": None,
                "score": 0,
                "reasons": set()
            }
        return results_map[key]

    # --- 1. Find matching calls ---
    cursor.execute('''
        SELECT caller_symbol_id, file_id FROM calls 
        WHERE project_id = ? AND LOWER(raw_callee_name) LIKE ?
    ''', (project_id, like_query))
    
    call_symbol_ids = set()
    call_file_ids = set()
    for row in cursor.fetchall():
        if row["caller_symbol_id"]:
            call_symbol_ids.add(row["caller_symbol_id"])
        else:
            call_file_ids.add(row["file_id"])
            
    # --- 2. Find matching imports ---
    cursor.execute('''
        SELECT file_id FROM imports 
        WHERE project_id = ? AND (LOWER(module) LIKE ? OR LOWER(imported_name) LIKE ?)
    ''', (project_id, like_query, like_query))
    import_file_ids = {row["file_id"] for row in cursor.fetchall()}
    
    # --- 3. Process Symbols ---
    # Fetch symbols that match textually
    cursor.execute('''
        SELECT * FROM symbols 
        WHERE project_id = ? AND (
            LOWER(name) LIKE ? OR
            LOWER(parameters) LIKE ? OR
            LOWER(docstring) LIKE ?
        )
    ''', (project_id, like_query, like_query, like_query))
    matched_symbols = cursor.fetchall()
    
    # Also fetch symbols that were matched via calls but not textually
    matched_sym_ids = {s["deterministic_id"] for s in matched_symbols}
    missing_sym_ids = call_symbol_ids - matched_sym_ids
    
    if missing_sym_ids:
        missing_list = list(missing_sym_ids)
        for i in range(0, len(missing_list), 900):
            batch = missing_list[i:i+900]
            placeholders = ",".join("?" for _ in batch)
            params = [project_id] + batch
            cursor.execute(f'''
                SELECT * FROM symbols WHERE project_id = ? AND deterministic_id IN ({placeholders})
            ''', params)
            matched_symbols.extend(cursor.fetchall())
            
    for sym in matched_symbols:
        entry = get_symbol_entry(sym)
        sym_name_lower = sym["name"].lower()
        
        # Symbol Name Matches
        if sym_name_lower == query_lower:
            entry["score"] += 100
            entry["reasons"].add("exact symbol name match")
        elif sym_name_lower.startswith(query_lower):
            entry["score"] += 80
            entry["reasons"].add("prefix symbol name match")
        elif query_lower in sym_name_lower:
            entry["score"] += 60
            entry["reasons"].add("substring symbol name match")
            
        # Parameter Match
        if sym["parameters"] and query_lower in sym["parameters"].lower():
            entry["score"] += 30
            entry["reasons"].add("parameter match")
            
        # Docstring Match
        if sym["docstring"] and query_lower in sym["docstring"].lower():
            entry["score"] += 20
            entry["reasons"].add("docstring match")
            
        # Call Match
        if sym["deterministic_id"] in call_symbol_ids:
            entry["score"] += 15
            entry["reasons"].add("import/call match")
            
    # --- 4. Process Files ---
    # Fetch files that match textually
    cursor.execute('''
        SELECT * FROM files 
        WHERE project_id = ? AND (
            LOWER(relative_path) LIKE ? OR
            LOWER(source) LIKE ?
        )
    ''', (project_id, like_query, like_query))
    matched_files = cursor.fetchall()
    
    matched_f_ids = {f["id"] for f in matched_files}
    file_ids_from_calls_imports = call_file_ids | import_file_ids
    missing_file_ids = file_ids_from_calls_imports - matched_f_ids
    
    if missing_file_ids:
        missing_list = list(missing_file_ids)
        for i in range(0, len(missing_list), 900):
            batch = missing_list[i:i+900]
            placeholders = ",".join("?" for _ in batch)
            params = [project_id] + batch
            cursor.execute(f'''
                SELECT * FROM files WHERE project_id = ? AND id IN ({placeholders})
            ''', params)
            matched_files.extend(cursor.fetchall())
            
    for f in matched_files:
        entry = get_file_entry(f)
        rel_path = f["relative_path"].lower()
        
        # Path Match
        if query_lower in rel_path:
            entry["score"] += 40
            entry["reasons"].add("filename/path match")
            
        # Import/Call Match
        if f["id"] in file_ids_from_calls_imports:
            entry["score"] += 15
            entry["reasons"].add("import/call match")
            
        # Source Match
        # (SQLite LIKE matched it, but we double-check in Python for exact substring match
        # to ensure accuracy and to correctly award the score only if it really matches)
        if f["source"] and query_lower in f["source"].lower():
            entry["score"] += 5
            entry["reasons"].add("raw source match")
            
    conn.close()
    
    # Convert map to list and filter zero-score results (just in case)
    results = [res for res in results_map.values() if res["score"] > 0]
    
    # Sort reasons for deterministic output
    for r in results:
        r["reasons"] = sorted(list(r["reasons"]))
        
    # Sort results: highest score first, deterministic tie-breaking (by id)
    results.sort(key=lambda x: (-x["score"], x["id"]))
    
    return results[:limit]
