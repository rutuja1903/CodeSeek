import React, { useRef, useEffect } from 'react';

/**
 * CodeEditor -- Focused, zero-dependency controlled Python code editor.
 * 
 * Features:
 * - Synchronized line numbers gutter
 * - Four-space Tab indentation and Shift+Tab unindent (single or multi-line)
 * - Ctrl+S / Cmd+S save shortcut (preventing browser save dialog)
 * - Selected line range highlighting and smooth auto-scrolling
 * - Usable rendering for empty files, blank lines, and trailing newlines
 */
export default function CodeEditor({
  value,
  onChange,
  onSave,
  highlightRange,
  readOnly = false,
  placeholder = 'Enter Python code here...',
}) {
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);
  const backdropRef = useRef(null);

  const lines = value.split('\n');
  const lineCount = Math.max(1, lines.length);

  // Synchronize scrolling between textarea, gutter, and backdrop highlight layer
  const handleScroll = () => {
    if (!textareaRef.current) return;
    const { scrollTop, scrollLeft } = textareaRef.current;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
    if (backdropRef.current) {
      backdropRef.current.scrollTop = scrollTop;
      backdropRef.current.scrollLeft = scrollLeft;
    }
  };

  // Scroll to highlightRange.start when it changes
  useEffect(() => {
    if (!highlightRange || !highlightRange.start || !textareaRef.current) return;
    const targetLine = highlightRange.start;
    // Each line is ~24px (1.5rem at 16px)
    const lineHeightPx = 24;
    const targetScrollTop = Math.max(0, (targetLine - 1) * lineHeightPx - 100);
    textareaRef.current.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  }, [highlightRange]);

  // Tab (indent), Shift+Tab (unindent), and Ctrl+S / Cmd+S shortcuts
  const handleKeyDown = (e) => {
    // 1. Save shortcut: Ctrl+S / Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (onSave) {
        onSave();
      }
      return;
    }

    // 2. Tab / Shift+Tab indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      if (readOnly) return;

      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      // Single line cursor / selection
      if (start === end || !val.substring(start, end).includes('\n')) {
        if (!e.shiftKey) {
          // Indent: insert 4 spaces
          const nextVal = val.substring(0, start) + '    ' + val.substring(end);
          onChange(nextVal);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = start + 4;
          });
        } else {
          // Shift+Tab on single line: unindent up to 4 spaces before cursor
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          const lineText = val.substring(lineStart, start);
          const match = lineText.match(/^ {1,4}/);
          if (match) {
            const spacesToRemove = match[0].length;
            const nextVal = val.substring(0, lineStart) + val.substring(lineStart + spacesToRemove);
            onChange(nextVal);
            requestAnimationFrame(() => {
              textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - spacesToRemove);
            });
          }
        }
        return;
      }

      // Multi-line block indentation
      const blockStart = val.lastIndexOf('\n', start - 1) + 1;
      const blockEnd = end === 0 || val[end - 1] === '\n' ? end : (val.indexOf('\n', end) === -1 ? val.length : val.indexOf('\n', end));
      const blockText = val.substring(blockStart, blockEnd);
      const blockLines = blockText.split('\n');

      let modifiedLines;
      let lengthDiff = 0;

      if (!e.shiftKey) {
        // Indent every line in block by 4 spaces
        modifiedLines = blockLines.map(line => '    ' + line);
        lengthDiff = blockLines.length * 4;
      } else {
        // Unindent every line in block by up to 4 spaces
        modifiedLines = blockLines.map(line => {
          if (line.startsWith('    ')) return line.substring(4);
          return line.replace(/^ {1,3}/, '');
        });
        const newBlockText = modifiedLines.join('\n');
        lengthDiff = newBlockText.length - blockText.length;
      }

      const nextVal = val.substring(0, blockStart) + modifiedLines.join('\n') + val.substring(blockEnd);
      onChange(nextVal);
      requestAnimationFrame(() => {
        textarea.selectionStart = blockStart;
        textarea.selectionEnd = blockEnd + lengthDiff;
      });
    }
  };

  return (
    <div 
      className="code-editor-root"
      style={{
        display: 'flex',
        flex: 1,
        height: '100%',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-color)',
        fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace',
        fontSize: '0.95rem',
        lineHeight: '1.5rem',
      }}
    >
      {/* 1. Line Numbers Gutter */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        style={{
          width: '56px',
          minWidth: '56px',
          height: '100%',
          overflow: 'hidden',
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          borderRight: '1px solid var(--border-color)',
          userSelect: 'none',
          padding: '16px 0',
          boxSizing: 'border-box',
          color: 'var(--text-muted)',
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {Array.from({ length: lineCount }).map((_, idx) => {
          const lineNum = idx + 1;
          const isHighlighted = highlightRange && lineNum >= highlightRange.start && lineNum <= highlightRange.end;
          return (
            <div
              key={lineNum}
              style={{
                height: '1.5rem',
                lineHeight: '1.5rem',
                paddingRight: '12px',
                fontSize: '0.85rem',
                fontWeight: isHighlighted ? 'bold' : 'normal',
                color: isHighlighted ? 'var(--primary-color)' : 'var(--text-muted)',
                backgroundColor: isHighlighted ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                borderRight: isHighlighted ? '2px solid var(--primary-color)' : '2px solid transparent',
                boxSizing: 'border-box',
                opacity: isHighlighted ? 1 : 0.6,
              }}
            >
              {lineNum}
            </div>
          );
        })}
      </div>

      {/* 2. Code Area (Overlay Backdrop + Textarea) */}
      <div 
        style={{
          flex: 1,
          height: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Backdrop for line-range highlight */}
        <div
          ref={backdropRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
            overflow: 'hidden',
            padding: '16px 20px',
            boxSizing: 'border-box',
            whiteSpace: 'pre',
          }}
        >
          {Array.from({ length: lineCount }).map((_, idx) => {
            const lineNum = idx + 1;
            const isHighlighted = highlightRange && lineNum >= highlightRange.start && lineNum <= highlightRange.end;
            return (
              <div
                key={lineNum}
                style={{
                  height: '1.5rem',
                  lineHeight: '1.5rem',
                  width: '100%',
                  minWidth: '100%',
                  backgroundColor: isHighlighted ? 'rgba(59, 130, 246, 0.18)' : 'transparent',
                  borderLeft: isHighlighted ? '3px solid var(--primary-color)' : '3px solid transparent',
                  boxSizing: 'border-box',
                }}
              />
            );
          })}
        </div>

        {/* The actual editable Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            padding: '16px 20px',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflow: 'auto',
            background: 'transparent',
            color: 'var(--text-main)',
            fontFamily: 'Consolas, Monaco, "Courier New", Courier, monospace',
            fontSize: '0.95rem',
            lineHeight: '1.5rem',
            tabSize: 4,
            whiteSpace: 'pre',
            wordWrap: 'normal',
            zIndex: 1,
          }}
        />
      </div>
    </div>
  );
}
