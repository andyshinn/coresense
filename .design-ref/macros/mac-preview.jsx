// mac-preview.jsx — live render + Reply/New-send toggle + char budget + inline
// validation. Renders the macro against concrete sample data; greys variables
// that don't resolve in the chosen mode; flags parse/unknown errors distinctly.
const { MT: PT, MFONT: PFONT, MMONO: PMONO, MI: PMI, Segmented: PSeg, Eyebrow: PEye, Badge: PBadge } = window.MacUI;
const PLIM = window.MAC_MSG_LIMIT;

const SEG_STYLE = {
  out:         { color: PT.text },
  placeholder: { color: PT.textDim, fontStyle: 'italic' },
  unavail:     { color: PT.warn, fontStyle: 'italic' },
};

function PreviewBody({ segments }) {
  if (!segments.length) return <span style={{ color: PT.textDim, fontStyle: 'italic' }}>Nothing to preview yet.</span>;
  return segments.map((s, i) => {
    if (s.kind === 'error') {
      return (
        <span key={i} title={s.message} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: PT.dangerBg, color: PT.danger, border: `1px solid rgba(239,68,68,0.35)`, borderRadius: 4, padding: '0 4px', margin: '0 1px', fontFamily: PMONO, fontSize: 12, verticalAlign: 'baseline' }}>
          {React.createElement(PMI.alert, { size: 11 })}{s.text}
        </span>
      );
    }
    return <span key={i} style={SEG_STYLE[s.kind] || SEG_STYLE.out}>{s.text}</span>;
  });
}

function CharBudget({ count, worst, invalid }) {
  const pct = Math.min(count / PLIM, 1);
  const over = count > PLIM;
  const worstOver = worst != null && worst > PLIM;
  const fill = over ? PT.danger : count > PLIM * 0.85 ? PT.warn : PT.online;
  const worstPos = worst != null ? Math.min(worst / PLIM, 1) * 100 : null;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: PMONO, fontSize: 18, fontWeight: 600, color: invalid ? PT.textDim : over ? PT.danger : PT.text, fontVariantNumeric: 'tabular-nums' }}>
          {invalid ? '—' : count}
        </span>
        <span style={{ fontFamily: PMONO, fontSize: 12, color: PT.textDim }}>/ {PLIM} chars</span>
        <div style={{ flex: 1 }} />
        {!invalid && worst != null && (
          <span style={{ fontFamily: PMONO, fontSize: 11, color: worstOver ? PT.danger : PT.textDim }}>
            worst case {worst}
          </span>
        )}
      </div>
      <div style={{ position: 'relative', height: 6, borderRadius: 4, background: PT.bg, overflow: 'visible', border: `1px solid ${PT.border}` }}>
        {/* over-limit zone */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct * 100}%`, height: '100%', background: fill, transition: 'width .15s, background .15s' }} />
        </div>
        {/* worst-case marker */}
        {!invalid && worstPos != null && (
          <span title={`worst case: ${worst} chars`} style={{ position: 'absolute', top: -3, left: `calc(${worstPos}% - 1px)`, width: 2, height: 12, background: worstOver ? PT.danger : PT.borderStrong, borderRadius: 2 }} />
        )}
      </div>
      {!invalid && over && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, fontSize: 11.5, color: PT.danger }}>
          <span style={{ display: 'inline-flex' }}>{React.createElement(PMI.alert, { size: 12 })}</span>
          {count - PLIM} over the {PLIM}-char limit — this won’t send.
        </div>
      )}
      {!invalid && !over && worstOver && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, fontSize: 11.5, color: PT.warn }}>
          <span style={{ display: 'inline-flex' }}>{React.createElement(PMI.alert, { size: 12 })}</span>
          Fits now, but could reach {worst} chars with longer values.
        </div>
      )}
    </div>
  );
}

function ValidationStrip({ errors }) {
  if (!errors.length) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: PT.online }}>
        <span style={{ display: 'inline-flex' }}>{React.createElement(PMI.check, { size: 13 })}</span>
        Valid — renders against the sample data.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {errors.map((e, i) => {
        const danger = e.severity === 'error';
        const col = danger ? PT.danger : PT.warn;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: col, lineHeight: 1.4 }}>
            <span style={{ display: 'inline-flex', flex: '0 0 auto', marginTop: 1 }}>{React.createElement(PMI.alert, { size: 13 })}</span>
            <span><b style={{ fontWeight: 600 }}>{danger ? 'Error' : 'Warning'}:</b> {e.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function SampleCaption({ mode }) {
  const c = window.MAC_DATA.contexts[mode === 'send' ? 'send' : 'reply'];
  const text = mode === 'send'
    ? <React.Fragment>New message to <b style={{ color: PT.textMuted, fontWeight: 600 }}>{c.peer_name}</b> · always-vars only</React.Fragment>
    : <React.Fragment>Replying to <b style={{ color: PT.textMuted, fontWeight: 600 }}>{c.sender_name}</b> · {c.rssi} dBm / {c.snr} snr · {c.hops} hops</React.Fragment>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: PMONO, fontSize: 10.5, color: PT.textDim }}>
      <span style={{ display: 'inline-flex', color: mode === 'send' ? PT.online : PT.accent }}>{React.createElement(mode === 'send' ? PMI.send : PMI.reply, { size: 12 })}</span>
      {text}
    </div>
  );
}

function MacPreview({ value, mode, onModeChange, units = 'km' }) {
  const render = window.MAC_LIQUID.render(value || '', window.MAC_DATA.contexts[mode === 'send' ? 'send' : 'reply'], mode, units);
  const { errors } = window.MAC_LIQUID.highlight(value || '', mode);
  const worst = window.MAC_LIQUID.worstCase(value || '', mode, units);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${PT.border}` }}>
        <span style={{ color: PT.accent, display: 'inline-flex' }}>{React.createElement(PMI.eye, { size: 15 })}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: PT.text }}>Preview</span>
        <div style={{ flex: 1 }} />
        <PSeg size="sm" value={mode} onChange={onModeChange}
          options={[{ value: 'reply', label: 'Reply', icon: 'reply' }, { value: 'send', label: 'New send', icon: 'send' }]} />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SampleCaption mode={mode} />

        {/* rendered message bubble */}
        <div style={{ background: PT.bg, border: `1px solid ${PT.border}`, borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontFamily: PFONT, fontSize: 13.5, lineHeight: 1.5, color: PT.text, wordBreak: 'break-word', whiteSpace: 'pre-wrap', minHeight: 20 }}>
            <PreviewBody segments={render.segments} />
          </div>
        </div>

        <CharBudget count={render.length} worst={worst} invalid={render.hasError} />

        <div style={{ height: 1, background: PT.border }} />
        <ValidationStrip errors={errors} />
      </div>
    </div>
  );
}

window.MacPreview = MacPreview;
