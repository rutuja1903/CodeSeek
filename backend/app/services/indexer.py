"""
indexer.py -- CodeSeek Indexer Module

Coordinates scanning, parsing, and storing a project into SQLite.
"""

import json
from app.services.scanner import scan_repository
from app.services.parser import parse_repository
from app.database.core import get_connection, init_db

def index_project(project_name: str, root_dir: str, db_path: str = "codeseek.db"):
    """
    Index a project by scanning its files, parsing them, and storing
    the metadata in the database.

    If the project already exists (by name), it is completely removed
    and re-indexed (full wipe-and-rebuild).
    """
    # Ensure database is initialized
    init_db(db_path)
    
    conn = get_connection(db_path)
    cursor = conn.cursor()

    # 1. Full wipe-and-rebuild: Delete existing project with this name
    cursor.execute("DELETE FROM projects WHERE name = ?", (project_name,))
    
    # 2. Create the project record
    cursor.execute(
        "INSERT INTO projects (name, root_path) VALUES (?, ?)",
        (project_name, root_dir)
    )
    project_id = cursor.lastrowid

    # 3. Scan for Python files
    python_files = scan_repository(root_dir)

    # 4. Parse all files
    # The parser handles SyntaxErrors internally and returns a result dict for each
    parse_results = parse_repository(root_dir, python_files)

    # 5. Store data in SQLite
    for result in parse_results:
        # Insert file
        cursor.execute('''
            INSERT INTO files (
                project_id, relative_path, language, line_count, source,
                parse_status, parse_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            project_id,
            result["file_path"],
            "python",
            result["line_count"],
            result["source_code"],
            result["parse_ok"],
            result["error"]
        ))
        file_id = cursor.lastrowid

        # Insert symbols
        for sym in result["symbols"]:
            cursor.execute('''
                INSERT INTO symbols (
                    deterministic_id, project_id, file_id, name, symbol_type,
                    start_line, end_line, parent_id, parameters, docstring, bases
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                sym["symbol_id"],
                project_id,
                file_id,
                sym["name"],
                sym["type"],
                sym["start_line"],
                sym["end_line"],
                sym["parent_id"],
                json.dumps(sym["parameters"]) if sym["parameters"] else "[]",
                sym["docstring"],
                json.dumps(sym["bases"]) if sym["bases"] else "[]"
            ))
        
        # Insert imports
        for imp in result["imports"]:
            cursor.execute('''
                INSERT INTO imports (
                    project_id, file_id, module, imported_name, alias, line_number
                ) VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                project_id,
                file_id,
                imp["module"],
                imp["name"],
                imp["alias"],
                imp["line_number"]
            ))

        # Insert calls
        for call in result["calls"]:
            cursor.execute('''
                INSERT INTO calls (
                    project_id, file_id, caller_symbol_id, raw_callee_name, line_number
                ) VALUES (?, ?, ?, ?, ?)
            ''', (
                project_id,
                file_id,
                call["caller_id"],
                call["callee_name"],
                call["line_number"]
            ))

    conn.commit()
    conn.close()
    
    return project_id
