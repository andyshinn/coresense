// mac-studio.jsx — the macro authoring workspace: meta (name/scope/mode) +
// syntax editor + reference + preview, wired together. Rendered in three
// layout arrangements (split / columns / stacked) for side-by-side comparison.
const { MT: ST, MFONT: SFONT, MMONO: SMONO, MI: SMI, Btn: SBtn, Eyebrow: SEye, Segmented: SSeg, ScopeTag: SScope, ModeChip: SMode } = window.MacUI;
const { MacEditor: SEditor, insertAtCaret: SInsert } = window.MacEditorKit;

// quick-insert chips above the editor (the most common building blocks)
const QUICK = ['sender_name', 'rssi', 'snr', 'my_pos', 'peer_name'];

function ScopePicker({ scope, setScope, scopeLabel, setScopeLabel }) {
  const channels = ['Public', '#testing', '#bot', '#andy'];
  const contacts = ['Karin VK3', 'Mt. Bonnell 🗻', 'Mueller Repeater'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <SSeg size="sm" value={scope} onChange={(v) => { setScope(v); setScopeLabel(v === 'channel' ? channels[1] : v === 'contact' ? contacts[0] : null); }}
        options={[{ value: 'global', label: 'Global', icon: 'globe' }, { value: 'channel', label: 'Channel', icon: 'hash' }, { value: 'contact', label: 'Contact', icon: 'user' }]} />
      {scope !== 'global' && (
        <div style={{ position: 'relative' }}>
          <select value={scopeLabel || ''} onChange={(e) => setScopeLabel(e.target.value)}
            style={{ appearance: 'none', height: 28, padding: '0 26px 0 10px', borderRadius: 7, border: `1px solid ${ST.border}`, background: ST.bg, color: ST.text, fontFamily: SFONT, fontSize: 12.5, cursor: 'pointer' }}>
            {(scope === 'channel' ? channels : contacts).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <span style={{ position: 'absolute', right: 8, top: 8, color: ST.textDim, pointerEvents: 'none', display: 'inline-flex' }}>{React.createElement(SMI.chevDown, { size: 12 })}</span>
        </div>
      )}
    </div>
  );
}

function Meta({ st }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <input value={st.name} onChange={(e) => st.setName(e.target.value)} placeholder="Macro name" spellCheck={false}
          style={{ flex: 1, minWidth: 0, height: 34, padding: '0 12px', borderRadius: 8, border: `1px solid ${ST.border}`, background: ST.bg, color: ST.text, fontFamily: SFONT, fontSize: 14, fontWeight: 500, outline: 'none' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: ST.textDim, fontFamily: SMONO }}>SCOPE</span>
        <ScopePicker scope={st.scope} setScope={st.setScope} scopeLabel={st.scopeLabel} setScopeLabel={st.setScopeLabel} />
      </div>
    </div>
  );
}

// The editor region (meta + quick chips + the highlighted field).
function EditorPane({ st, showMeta = true, label = 'Template' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, height: '100%' }}>
      {showMeta && <Meta st={st} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SEye>{label}</SEye>
          <span style={{ fontSize: 11, color: ST.textDim }}>LiquidJS · type <span style={{ fontFamily: SMONO, color: ST.textMuted }}>{'{{'}</span> to insert</span>
          <div style={{ flex: 1 }} />
          {st.dirty && <span style={{ fontFamily: SMONO, fontSize: 10, color: ST.warn }}>● unsaved</span>}
        </div>
        <SEditor value={st.value} onChange={st.setValue} mode={st.mode} taRef={st.taRef} minHeight={100} placeholder="e.g.  {{sender_name}}: {{rssi}}dBm via {{hops}} hops" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, color: ST.textDim, fontFamily: SMONO, marginRight: 2 }}>QUICK</span>
          {QUICK.map(n => (
            <button key={n} onClick={() => st.insertVar(n)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px', borderRadius: 6, border: `1px solid ${ST.border}`, background: ST.bg2, color: ST.accent, fontFamily: SMONO, fontSize: 11, cursor: 'pointer' }}>
              {React.createElement(SMI.plus, { size: 10 })}{n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkspaceHeader({ st, onClose }) {
  const invalid = window.MAC_LIQUID.render(st.value, window.MAC_DATA.contexts.reply, st.mode).hasError;
  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', height: 52, borderBottom: `1px solid ${ST.border}`, background: ST.bg2 }}>
      <button onClick={onClose} title="Back to library" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 7, border: `1px solid ${ST.border}`, background: 'transparent', color: ST.textMuted, cursor: 'pointer' }}>
        {React.createElement(SMI.chevRight, { size: 15, style: { transform: 'rotate(180deg)' } })}
      </button>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: ST.text, whiteSpace: 'nowrap' }}>{st.isNew ? 'New macro' : 'Edit macro'}</div>
        <div style={{ fontFamily: SMONO, fontSize: 10.5, color: ST.textDim }}>Macros / {st.name || 'untitled'}</div>
      </div>
      <div style={{ flex: 1 }} />
      <SMode mode={st.mode === 'send' ? 'send' : 'reply'} />
      <SBtn variant="ghost" size="sm" onClick={onClose}>Cancel</SBtn>
      <SBtn variant="default" size="sm" icon="check" title={invalid ? 'Fix errors before saving' : 'Save macro'}>{st.isNew ? 'Create' : 'Save'}</SBtn>
    </div>
  );
}

// ── shared state hook ──────────────────────────────────────────────────
function useStudio(seed) {
  const taRef = React.useRef(null);
  const [value, setValue] = React.useState(seed.template);
  const [name, setName] = React.useState(seed.name);
  const [scope, setScope] = React.useState(seed.scope);
  const [scopeLabel, setScopeLabel] = React.useState(seed.scopeLabel);
  const [mode, setMode] = React.useState(seed.mode === 'send' ? 'send' : 'reply');
  const insertVar = (n) => setValue(v => SInsert(taRef.current, v, `{{ ${n} }}`));
  const insertFilter = (t) => setValue(v => SInsert(taRef.current, v, t));
  return { taRef, value, setValue, name, setName, scope, setScope, scopeLabel, setScopeLabel, mode, setMode, insertVar, insertFilter, isNew: seed.isNew, dirty: value !== seed.template };
}

// Region wrappers with consistent borders.
const Pane = ({ children, style }) => <div style={{ background: ST.bg2, ...style }}>{children}</div>;

// ── LAYOUT A · Split — editor + reference on top, preview docked bottom ──
function LayoutSplit({ st, onClose }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: ST.bg, fontFamily: SFONT }}>
      <WorkspaceHeader st={st} onClose={onClose} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, padding: 18, overflowY: 'auto' }}>
            <EditorPane st={st} />
          </div>
          <div style={{ flex: '0 0 auto', height: 240, borderTop: `1px solid ${ST.border}` }}>
            <window.MacPreview value={st.value} mode={st.mode} onModeChange={st.setMode} />
          </div>
        </div>
        <div style={{ flex: '0 0 312px', width: 312, borderLeft: `1px solid ${ST.border}`, minHeight: 0 }}>
          <window.MacReference mode={st.mode} onInsertVar={st.insertVar} onInsertFilter={st.insertFilter} />
        </div>
      </div>
    </div>
  );
}

// ── LAYOUT B · Columns — editor | preview | reference, all side by side ──
function LayoutColumns({ st, onClose }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: ST.bg, fontFamily: SFONT }}>
      <WorkspaceHeader st={st} onClose={onClose} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1.15, minWidth: 0, padding: 18, overflowY: 'auto', borderRight: `1px solid ${ST.border}` }}>
          <EditorPane st={st} />
        </div>
        <div style={{ flex: 1, minWidth: 0, borderRight: `1px solid ${ST.border}`, minHeight: 0 }}>
          <window.MacPreview value={st.value} mode={st.mode} onModeChange={st.setMode} />
        </div>
        <div style={{ flex: '0 0 296px', width: 296, minHeight: 0 }}>
          <window.MacReference mode={st.mode} onInsertVar={st.insertVar} onInsertFilter={st.insertFilter} />
        </div>
      </div>
    </div>
  );
}

// ── LAYOUT C · Stacked — editor full width on top, preview+reference below ─
function LayoutStacked({ st, onClose }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: ST.bg, fontFamily: SFONT }}>
      <WorkspaceHeader st={st} onClose={onClose} />
      <div style={{ flex: '0 0 auto', padding: '18px 20px', borderBottom: `1px solid ${ST.border}` }}>
        <EditorPane st={st} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, borderRight: `1px solid ${ST.border}`, minHeight: 0 }}>
          <window.MacPreview value={st.value} mode={st.mode} onModeChange={st.setMode} />
        </div>
        <div style={{ flex: '0 0 320px', width: 320, minHeight: 0 }}>
          <window.MacReference mode={st.mode} onInsertVar={st.insertVar} onInsertFilter={st.insertFilter} />
        </div>
      </div>
    </div>
  );
}

window.MacStudio = { useStudio, LayoutSplit, LayoutColumns, LayoutStacked };
