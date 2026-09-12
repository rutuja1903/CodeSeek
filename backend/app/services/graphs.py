"""
graphs.py -- Dependency Analysis and Graph Generation

Converts indexed CodeSeek data into NetworkX graphs for:
- File dependencies (imports)
- Function/Method calls
"""
import networkx as nx
from app.database.core import get_connection

def build_file_dependency_graph(project_id: int, db_path: str = "codeseek.db"):
    """
    Builds a directed graph of file dependencies (internal imports).
    Returns (G, unresolved_imports)
    """
    conn = get_connection(db_path)
    cursor = conn.cursor()
    
    G = nx.DiGraph()
    
    # 1. Fetch all files and map module names to file paths
    cursor.execute("SELECT id, relative_path, language, line_count, parse_status FROM files WHERE project_id = ?", (project_id,))
    files = cursor.fetchall()
    
    module_to_file = {}
    id_to_path = {}
    
    for f in files:
        rel_path = f["relative_path"]
        file_id = f["id"]
        
        # Add node to graph
        G.add_node(rel_path, 
                   id=f"file_{file_id}", 
                   type="file", 
                   label=rel_path,
                   language=f["language"], 
                   line_count=f["line_count"], 
                   parse_status=bool(f["parse_status"]))
                   
        id_to_path[file_id] = rel_path
        
        # Convert path to module name
        # e.g., services/auth.py -> services.auth
        # e.g., models/__init__.py -> models
        
        mod = rel_path
        if mod.endswith(".py"):
            mod = mod[:-3]
        if mod.endswith("/__init__"):
            mod = mod[:-9]
        elif mod == "__init__":
            mod = ""
            
        mod = mod.replace("/", ".")
        module_to_file[mod] = rel_path
        
    # 2. Fetch imports and resolve edges
    cursor.execute("SELECT file_id, module, imported_name FROM imports WHERE project_id = ?", (project_id,))
    imports = cursor.fetchall()
    
    unresolved = []
    
    for imp in imports:
        src_path = id_to_path.get(imp["file_id"])
        if not src_path:
            continue
            
        module_part = imp["module"]
        name_part = imp["imported_name"]
        
        target_path = None
        
        if module_part is None:
            # "import name_part"
            target_path = module_to_file.get(name_part)
        else:
            # "from module_part import name_part"
            # It could be `module_part.name_part` is a file
            combined = f"{module_part}.{name_part}"
            if combined in module_to_file:
                target_path = module_to_file[combined]
            elif module_part in module_to_file:
                target_path = module_to_file[module_part]
                
        if target_path:
            # Add edge if not self-import
            if src_path != target_path:
                G.add_edge(src_path, target_path, type="imports")
        else:
            unresolved.append({
                "source_file": src_path,
                "module": module_part,
                "imported_name": name_part
            })
            
    conn.close()
    return G, unresolved

def build_call_graph(project_id: int, db_path: str = "codeseek.db"):
    """
    Builds a directed graph of function/method calls.
    Returns (G, unresolved_calls)
    """
    conn = get_connection(db_path)
    cursor = conn.cursor()
    
    G = nx.DiGraph()
    
    # 1. Fetch files mapping for context
    cursor.execute("SELECT id, relative_path FROM files WHERE project_id = ?", (project_id,))
    file_map = {row["id"]: row["relative_path"] for row in cursor.fetchall()}
    
    # 2. Fetch all functions/methods
    cursor.execute('''
        SELECT deterministic_id, name, symbol_type, file_id 
        FROM symbols 
        WHERE project_id = ? AND symbol_type IN ('function', 'async_function', 'method', 'async_method', 'nested_function')
    ''', (project_id,))
    
    symbols = cursor.fetchall()
    symbol_names_map = {} # Maps short name to list of IDs (for resolution)
    
    for sym in symbols:
        sym_id = sym["deterministic_id"]
        sym_name = sym["name"]
        
        G.add_node(sym_id, 
                   id=sym_id, 
                   label=sym_name, 
                   type=sym["symbol_type"], 
                   file_path=file_map.get(sym["file_id"], ""))
                   
        if sym_name not in symbol_names_map:
            symbol_names_map[sym_name] = []
        symbol_names_map[sym_name].append(sym_id)
        
    # 3. Fetch calls
    cursor.execute("SELECT caller_symbol_id, raw_callee_name FROM calls WHERE project_id = ?", (project_id,))
    calls = cursor.fetchall()
    
    unresolved = []
    
    for call in calls:
        caller = call["caller_symbol_id"]
        callee = call["raw_callee_name"]
        
        if not caller or not callee:
            continue
            
        # We only care if caller is in our symbols
        if not G.has_node(caller):
            continue
            
        # Very simple static resolution:
        # If callee is a simple name (e.g. "validate_email") and exists exactly once, resolve it.
        # If callee is dotted (e.g. "auth.login_user"), take the last part ("login_user")
        # and see if it uniquely matches.
        
        callee_short = callee.split(".")[-1]
        
        candidates = symbol_names_map.get(callee_short, [])
        if len(candidates) == 1:
            target = candidates[0]
            if caller != target:
                G.add_edge(caller, target, type="calls")
        else:
            unresolved.append({
                "caller": caller,
                "callee_raw": callee,
                "reason": "ambiguous" if len(candidates) > 1 else "not found"
            })
            
    conn.close()
    return G, unresolved

def graph_to_json(G, unresolved):
    """
    Convert a NetworkX graph and unresolved list into a JSON-friendly dict.
    """
    nodes = []
    for node, data in G.nodes(data=True):
        node_data = {"id": node}
        node_data.update(data)
        nodes.append(node_data)
        
    edges = []
    for source, target, data in G.edges(data=True):
        edges.append({
            "source": source,
            "target": target,
            "type": data.get("type", "unknown")
        })
        
    return {
        "nodes": nodes,
        "edges": edges,
        "unresolved": unresolved
    }

def calculate_graph_metrics(G):
    """
    Calculate basic graph metrics using NetworkX.
    """
    metrics = {
        "node_count": G.number_of_nodes(),
        "edge_count": G.number_of_edges(),
    }
    
    if metrics["node_count"] == 0:
        return metrics
        
    in_degrees = dict(G.in_degree())
    out_degrees = dict(G.out_degree())
    
    metrics["avg_in_degree"] = sum(in_degrees.values()) / metrics["node_count"]
    metrics["avg_out_degree"] = sum(out_degrees.values()) / metrics["node_count"]
    
    # Most depended-on / most called (highest in-degree)
    sorted_in = sorted(in_degrees.items(), key=lambda x: x[1], reverse=True)
    metrics["top_in_degree"] = [{"id": n, "count": d} for n, d in sorted_in[:5] if d > 0]
    
    return metrics
