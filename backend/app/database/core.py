"""
core.py -- SQLite Database Core

Manages the SQLite connection and schema creation for CodeSeek.
"""

import sqlite3

def get_connection(db_path="codeseek.db"):
    """
    Get a connection to the SQLite database.
    """
    conn = sqlite3.connect(db_path)
    # Enforce foreign key constraints
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn

def init_db(db_path="codeseek.db"):
    """
    Create the database schema if it doesn't exist.
    """
    conn = get_connection(db_path)
    cursor = conn.cursor()
    
    # Create projects table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Create files table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            relative_path TEXT NOT NULL,
            language TEXT NOT NULL,
            line_count INTEGER NOT NULL,
            source TEXT,
            parse_status BOOLEAN NOT NULL,
            parse_error TEXT,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
    ''')
    
    # Create symbols table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS symbols (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deterministic_id TEXT NOT NULL,
            project_id INTEGER NOT NULL,
            file_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            symbol_type TEXT NOT NULL,
            start_line INTEGER,
            end_line INTEGER,
            parent_id TEXT,
            parameters TEXT,
            docstring TEXT,
            bases TEXT,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
        )
    ''')
    
    # Create imports table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            file_id INTEGER NOT NULL,
            module TEXT,
            imported_name TEXT,
            alias TEXT,
            line_number INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
        )
    ''')
    
    # Create calls table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            file_id INTEGER NOT NULL,
            caller_symbol_id TEXT,
            raw_callee_name TEXT NOT NULL,
            line_number INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
        )
    ''')
    
    conn.commit()
    conn.close()
