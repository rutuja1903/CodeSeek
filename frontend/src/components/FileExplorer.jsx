import React, { useState, useEffect } from 'react';
import '../index.css';

const TreeNode = ({ node, onSelect, selectedId }) => {
  const [expanded, setExpanded] = useState(true);
  
  return (
    <div style={{ paddingLeft: node.name === 'root' ? '0' : '1.2rem' }}>
      {node.name !== 'root' && (
        <div 
          onClick={() => setExpanded(!expanded)} 
          style={{ cursor: 'pointer', fontWeight: 'bold', color: '#ccc', padding: '4px 0', userSelect: 'none' }}
        >
          {expanded ? '📂' : '📁'} {node.name}
        </div>
      )}
      {expanded && (
        <div>
          {Object.values(node.children).map(child => (
            <TreeNode key={child.name} node={child} onSelect={onSelect} selectedId={selectedId} />
          ))}
          {node.files.map(file => (
            <div 
              key={file.id} 
              onClick={() => onSelect(file)}
              style={{ 
                cursor: 'pointer', 
                padding: '4px 8px', 
                color: file.parse_status ? '#ddd' : 'var(--error-text)',
                backgroundColor: selectedId === file.id ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                borderRadius: '4px',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              title={file.relative_path.split('/').pop()}
            >
              <span style={{ fontSize: '0.9rem' }}>📄</span> 
              <span>{file.relative_path.split('/').pop()}</span>
              {!file.parse_status && <span style={{ color: 'var(--error-text)', fontSize: '0.8rem' }}>⚠️</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function FileExplorer({ overview }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileDetails, setFileDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        setLoading(true);
        const res = await fetch(`http://127.0.0.1:8000/projects/${overview.id}/files`);
        if (!res.ok) throw new Error("Failed to fetch files");
        const data = await res.json();
        
        // Sort files alphabetically
        data.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
        setFiles(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, [overview.id]);

  useEffect(() => {
    if (!selectedFile) return;

    const fetchDetails = async () => {
      try {
        setLoadingDetails(true);
        const res = await fetch(`http://127.0.0.1:8000/files/${selectedFile.id}`);
        if (!res.ok) throw new Error("Failed to fetch file details");
        const data = await res.json();
        setFileDetails(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingDetails(false);
      }
    };

    fetchDetails();
  }, [selectedFile]);

  // Build tree
  const treeRoot = { name: 'root', children: {}, files: [] };
  files.forEach(file => {
    const parts = file.relative_path.split('/');
    const fileName = parts.pop();
    let current = treeRoot;
    parts.forEach(part => {
      if (!current.children[part]) {
        current.children[part] = { name: part, children: {}, files: [] };
      }
      current = current.children[part];
    });
    current.files.push(file);
  });

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Column 2: File Tree */}
      <div style={{ 
        width: '300px', 
        borderRight: '1px solid var(--border-color)', 
        display: 'flex', 
        flexDirection: 'column',
        backgroundColor: 'var(--surface-color)',
        flexShrink: 0
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', fontWeight: '600' }}>
          Project Files
        </div>
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '12px' }}>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading files...</p>
          ) : error ? (
            <p className="alert error">{error}</p>
          ) : (
            <TreeNode node={treeRoot} onSelect={setSelectedFile} selectedId={selectedFile?.id} />
          )}
        </div>
      </div>

      {/* Column 3: Details & Source */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: 'var(--bg-color)' }}>
        {!selectedFile ? (
           <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
             Select a file to view details
           </div>
        ) : (
           <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
             <div style={{ 
               padding: '16px 24px', 
               borderBottom: '1px solid var(--border-color)', 
               backgroundColor: 'var(--surface-color)',
               display: 'flex',
               gap: '24px',
               alignItems: 'center',
               fontSize: '0.9rem',
               flexShrink: 0
             }}>
               <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>{selectedFile.relative_path}</div>
               <div style={{ color: 'var(--text-muted)' }}>Language: {selectedFile.language}</div>
               <div style={{ color: 'var(--text-muted)' }}>Lines: {selectedFile.line_count}</div>
               <div style={{ color: selectedFile.parse_status ? 'var(--success-text)' : 'var(--error-text)' }}>
                 {selectedFile.parse_status ? 'Parsed Successfully' : 'Parse Failed'}
               </div>
             </div>

             {!selectedFile.parse_status && selectedFile.parse_error && (
               <div className="alert error" style={{ margin: '16px 24px', flexShrink: 0 }}>
                 <strong>Parse Error:</strong> {selectedFile.parse_error}
               </div>
             )}

             <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                {loadingDetails ? (
                  <p style={{ color: 'var(--text-muted)' }}>Loading source code...</p>
                ) : fileDetails?.source ? (
                  <pre style={{ margin: 0, width: 'fit-content', minWidth: '100%' }}>
                    <code style={{ 
                      fontFamily: 'monospace', 
                      fontSize: '0.95rem', 
                      color: 'var(--text-main)', 
                      whiteSpace: 'pre'
                    }}>
                      {fileDetails.source}
                    </code>
                  </pre>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No source code available.</p>
                )}
             </div>
           </div>
        )}
      </div>
    </div>
  );
}

export default FileExplorer;
