// mac-editor.jsx — syntax-highlighted template editor.
// Technique: a transparent <textarea> (real caret + selection + typing) layered
// exactly over a <pre> that paints the colored, error-underlined tokens. Both
// share identical metrics so glyphs register 1:1.
const { MT: ET, MFONT: EFONT, MMONO: EMONO } = window.MacUI;
const SYN = window.MAC_SYNTAX;

const EDITOR_METRICS = {
  fontFamily: EMONO, fontSize: 14, lineHeight: 1.7, padding: '14px 16px',
  letterSpacing: 0, tabSize: 2,
};

function colorFor(type) {
  return {
    text: SYN.text, delim: SYN.delim, variable: SYN.variable, unavail: SYN.unavail,
    filter: SYN.filter, custom: SYN.custom, string: SYN.string, number: SYN.number, error: SYN.error,
  }[type] || SYN.text;
}

// The painted layer.
function Highlighted({ value, mode }) {
  const { runs } = window.MAC_LIQUID.highlight(value, mode);
  return (
    <pre aria-hidden="true" style={{
      margin: 0, position: 'absolute', inset: 0, pointerEvents: 'none',
      whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word',
      ...EDITOR_METRICS, color: SYN.text, overflow: 'hidden',
    }}>
      {runs.map((r, i) => {
        const cls = r.type === 'error' ? 'mac-err-underline' : r.type === 'unavail' ? 'mac-warn-underline' : undefined;
        return <span key={i} className={cls} style={{ color: colorFor(r.type), fontWeight: r.type === 'variable' || r.type === 'custom' || r.type === 'filter' ? 500 : 400 }}>{r.text}</span>;
      })}
      {/* keep trailing newline visible for wrap parity */}
      {value.endsWith('\n') ? '​' : null}
    </pre>
  );
}

// taRef (optional) is attached to the textarea so a parent can insert at caret.
function MacEditor({ value, onChange, mode = 'reply', minHeight = 96, taRef, autoFocus, placeholder }) {
  const innerRef = React.useRef(null);
  const ref = taRef || innerRef;
  const preWrapRef = React.useRef(null);

  // keep the painted layer scrolled with the textarea (multi-line wraps)
  const onScroll = (e) => {
    if (preWrapRef.current) {
      preWrapRef.current.scrollTop = e.target.scrollTop;
      preWrapRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  return (
    <div style={{ position: 'relative', background: ET.bg, border: `1px solid ${ET.border}`, borderRadius: 9, minHeight, overflow: 'hidden' }}>
      <div ref={preWrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <Highlighted value={value || ''} mode={mode} />
        {!value && placeholder ? (
          <div style={{ position: 'absolute', inset: 0, ...EDITOR_METRICS, color: ET.textDim, pointerEvents: 'none', whiteSpace: 'pre-wrap' }}>{placeholder}</div>
        ) : null}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={onScroll}
        autoFocus={autoFocus}
        spellCheck={false} autoCapitalize="off" autoCorrect="off"
        style={{
          position: 'relative', display: 'block', width: '100%', minHeight,
          resize: 'none', border: 'none', outline: 'none', background: 'transparent',
          color: 'transparent', caretColor: ET.accent,
          ...EDITOR_METRICS, overflow: 'auto', boxSizing: 'border-box',
          whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word',
        }}
      />
    </div>
  );
}

// Insert text at the textarea's caret (replacing any selection); returns the
// new full value and re-focuses with the caret after the insertion.
function insertAtCaret(ta, value, text) {
  if (!ta) return value + text;
  const s = ta.selectionStart ?? value.length;
  const e = ta.selectionEnd ?? value.length;
  const next = value.slice(0, s) + text + value.slice(e);
  // restore caret after React re-render
  requestAnimationFrame(() => { try { ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length; } catch {} });
  return next;
}

window.MacEditorKit = { MacEditor, insertAtCaret, EDITOR_METRICS };
