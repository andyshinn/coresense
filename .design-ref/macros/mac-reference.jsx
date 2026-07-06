// mac-reference.jsx — the right-panel variable + filter reference.
// Grouped (Always / Reply-only / custom + standard filters), searchable,
// click-to-insert. In "send" preview mode the reply-only group is greyed and
// marked, because those variables don't resolve there.
const { MT: RT, MFONT: RFONT, MMONO: RMONO, MI: RMI, TypeTag, Segmented, Eyebrow } = window.MacUI;
const RD = window.MAC_DATA;

// What each filter inserts when clicked (a realistic, ready-to-edit segment).
const FILTER_INSERT = {
  distance: ' | distance: peer_pos', bearing: ' | bearing: peer_pos', unit: " | unit: 'km'",
  first: ' | first', last: ' | last', size: ' | size',
  map: ' | map: "name"', join: ' | join: " → "', sort: ' | sort: "final_snr"',
};

function Row({ children, onClick, dim, title }) {
  const [h, setH] = React.useState(false);
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
        background: h ? RT.bg3 : 'transparent', borderRadius: 7, padding: '7px 9px',
        opacity: dim ? 0.55 : 1, transition: 'background .12s', position: 'relative',
      }}>
      {children}
      <span style={{ position: 'absolute', top: 8, right: 8, opacity: h ? 1 : 0, color: RT.accent, transition: 'opacity .12s', display: 'inline-flex' }}>
        {React.createElement(RMI.plus, { size: 13 })}
      </span>
    </button>
  );
}

function VarRow({ v, mode, onInsert }) {
  const unavailable = mode === 'send' && v.group === 'reply';
  return (
    <Row onClick={() => onInsert(v.name)} dim={unavailable} title={unavailable ? 'Not available when composing a new message' : `Insert {{ ${v.name} }}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 16 }}>
        <span style={{ flex: '1 1 auto', minWidth: 0, fontFamily: RMONO, fontSize: 12.5, color: unavailable ? RT.warn : RT.accent, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</span>
        <TypeTag kind={v.kind} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, marginTop: 3 }}>
        <span style={{ fontSize: 11, color: RT.textMuted, lineHeight: 1.35, flex: 1, minWidth: 0 }}>{v.desc}</span>
      </div>
      <div style={{ fontFamily: RMONO, fontSize: 10.5, color: RT.textDim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{unavailable ? 'reply only' : v.sample}</div>
    </Row>
  );
}

function FilterRow({ f, onInsert }) {
  return (
    <Row onClick={() => onInsert(FILTER_INSERT[f.name] || ` | ${f.name}`)} title={`Insert ${f.name}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingRight: 16 }}>
        <span style={{ fontFamily: RMONO, fontSize: 12.5, color: f.custom ? RT.text : RT.text, fontWeight: 500 }}>{f.name}</span>
        {f.custom ? <span style={{ fontFamily: RMONO, fontSize: 9, color: '#7fd1c4', border: '1px solid rgba(127,209,196,0.4)', borderRadius: 3, padding: '0 4px', lineHeight: '14px' }}>MeshCore</span> : null}
      </div>
      <div style={{ fontSize: 11, color: RT.textMuted, marginTop: 3, lineHeight: 1.35, paddingRight: 16 }}>{f.desc}</div>
      <div style={{ fontFamily: RMONO, fontSize: 10.5, color: RT.textDim, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.example}</div>
    </Row>
  );
}

function GroupHead({ children, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 9px 5px' }}>
      <Eyebrow>{children}</Eyebrow>
      <span style={{ fontFamily: RMONO, fontSize: 9.5, color: RT.textDim }}>{count}</span>
      <div style={{ flex: 1, height: 1, background: RT.border }} />
    </div>
  );
}

function MacReference({ mode, onInsertVar, onInsertFilter }) {
  const [tab, setTab] = React.useState('vars');
  const [q, setQ] = React.useState('');
  const query = q.trim().toLowerCase();

  const matchV = (v) => !query || v.name.toLowerCase().includes(query) || v.desc.toLowerCase().includes(query);
  const matchF = (f) => !query || f.name.toLowerCase().includes(query) || f.desc.toLowerCase().includes(query);

  const always = RD.variables.filter(v => v.group === 'always' && matchV(v));
  const replyV = RD.variables.filter(v => v.group === 'reply' && matchV(v));
  const custom = RD.filters.filter(f => f.custom && matchF(f));
  const standard = RD.filters.filter(f => !f.custom && matchF(f));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: RT.bg2 }}>
      <div style={{ flex: '0 0 auto', padding: '12px 12px 10px', borderBottom: `1px solid ${RT.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
          <span style={{ color: RT.accent, display: 'inline-flex' }}>{React.createElement(RMI.braces, { size: 15 })}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: RT.text }}>Reference</span>
          <div style={{ flex: 1 }} />
          <Segmented size="sm" value={tab} onChange={setTab} options={[{ value: 'vars', label: 'Variables' }, { value: 'filters', label: 'Filters' }]} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', background: RT.bg, border: `1px solid ${RT.border}`, borderRadius: 8 }}>
          <span style={{ color: RT.textDim, display: 'inline-flex' }}>{React.createElement(RMI.search, { size: 13 })}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'vars' ? 'Search variables…' : 'Search filters…'} spellCheck={false}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: RT.text, fontFamily: RFONT, fontSize: 12.5 }} />
          {q ? <button onClick={() => setQ('')} style={{ border: 'none', background: 'transparent', color: RT.textDim, cursor: 'pointer', display: 'inline-flex', padding: 0 }}>{React.createElement(RMI.x, { size: 12 })}</button> : null}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 6px 14px' }}>
        {tab === 'vars' ? (
          <React.Fragment>
            <GroupHead count={always.length}>Always available</GroupHead>
            {always.map(v => <VarRow key={v.name} v={v} mode={mode} onInsert={onInsertVar} />)}
            <GroupHead count={replyV.length}>Reply only</GroupHead>
            {mode === 'send' && (
              <div style={{ display: 'flex', gap: 7, padding: '4px 9px 8px', fontSize: 11, color: RT.warn, lineHeight: 1.4 }}>
                <span style={{ display: 'inline-flex', flex: '0 0 auto', marginTop: 1 }}>{React.createElement(RMI.info, { size: 13 })}</span>
                <span>Greyed out — these resolve only when replying to a received message.</span>
              </div>
            )}
            {replyV.map(v => <VarRow key={v.name} v={v} mode={mode} onInsert={onInsertVar} />)}
            {!always.length && !replyV.length && <Empty />}
          </React.Fragment>
        ) : (
          <React.Fragment>
            <GroupHead count={custom.length}>MeshCore filters</GroupHead>
            {custom.map(f => <FilterRow key={f.name} f={f} onInsert={onInsertFilter} />)}
            <GroupHead count={standard.length}>Standard</GroupHead>
            {standard.map(f => <FilterRow key={f.name} f={f} onInsert={onInsertFilter} />)}
            {!custom.length && !standard.length && <Empty />}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

const Empty = () => (
  <div style={{ textAlign: 'center', padding: '22px 12px', color: RT.textDim, fontSize: 12 }}>No matches.</div>
);

window.MacReference = MacReference;
