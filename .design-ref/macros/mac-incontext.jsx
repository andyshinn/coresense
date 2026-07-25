// mac-incontext.jsx — how macros show up in the chat surface:
//   A · Composer autocomplete — type a trigger, pick a saved macro, it expands
//       to its rendered text (Popover/Command pattern).
//   B · Quick-reply menu — fire a reply macro straight at a received message.
//   C · Variable autocomplete — the {{ }} completion popover inside the editor,
//       with a HoverCard preview of the focused variable.
const { MT: IT, MFONT: IFONT, MMONO: IMONO, MI: IMI, Btn: IBtn, Badge: IBadge, ScopeTag: IScope, ModeChip: IMode, Dot: IDot } = window.MacUI;
const { MacEditor: IEditor } = window.MacEditorKit;
const ID = window.MAC_DATA;

const replyCtx = ID.contexts.reply;
const renderPlain = (tpl, mode = 'reply') => window.MAC_LIQUID.render(tpl, ID.contexts[mode === 'send' ? 'send' : 'reply'], mode).plain;

// ── shared chat chrome ──────────────────────────────────────────────────
function ThreadHeader({ name, sub }) {
  return (
    <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${IT.border}`, background: IT.bg2 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: IT.bg4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: IT.accent, flex: '0 0 auto' }}>{React.createElement(IMI.user, { size: 15 })}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: IT.text }}>{name}</div>
        <div style={{ fontFamily: IMONO, fontSize: 10.5, color: IT.textDim }}>{sub}</div>
      </div>
      <div style={{ flex: 1 }} />
      <IDot color={IT.online} size={6} />
    </div>
  );
}

function Bubble({ side = 'in', children, meta, sent }) {
  const incoming = side === 'in';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: incoming ? 'flex-start' : 'flex-end', gap: 3 }}>
      <div style={{ maxWidth: '78%', padding: '9px 12px', borderRadius: 12, borderBottomLeftRadius: incoming ? 3 : 12, borderBottomRightRadius: incoming ? 12 : 3,
        background: incoming ? IT.bg3 : IT.accent, color: incoming ? IT.text : '#1a1206', fontSize: 13.5, lineHeight: 1.45, border: incoming ? `1px solid ${IT.border}` : 'none', position: 'relative' }}>
        {children}
        {sent && <span style={{ position: 'absolute', right: 6, bottom: -16, fontFamily: IMONO, fontSize: 9, color: IT.online, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{React.createElement(IMI.check, { size: 10 })}sent</span>}
      </div>
      {meta && <div style={{ fontFamily: IMONO, fontSize: 9.5, color: IT.textDim, padding: '0 4px' }}>{meta}</div>}
    </div>
  );
}

// Render a macro's output as colored segments inline (for previews in menus).
function RenderedInline({ tpl, mode = 'reply', size = 12.5 }) {
  const r = window.MAC_LIQUID.render(tpl, ID.contexts[mode === 'send' ? 'send' : 'reply'], mode);
  const map = { out: IT.text, placeholder: IT.textDim, unavail: IT.warn };
  return (
    <span style={{ fontSize: size, lineHeight: 1.4 }}>
      {r.segments.map((s, i) => s.kind === 'error'
        ? <span key={i} style={{ color: IT.danger }}>{s.text}</span>
        : <span key={i} style={{ color: map[s.kind] || IT.text, fontStyle: s.kind === 'placeholder' ? 'italic' : 'normal' }}>{s.text}</span>)}
    </span>
  );
}

// ── A · Composer macro autocomplete ─────────────────────────────────────
function ComposerAutocomplete() {
  const [input, setInput] = React.useState('/');
  const [sel, setSel] = React.useState(0);
  const macros = ID.examples;
  const open = input.startsWith('/');
  const q = open ? input.slice(1).toLowerCase() : '';
  const matches = macros.filter(m => !q || m.name.toLowerCase().includes(q) || m.template.toLowerCase().includes(q));
  React.useEffect(() => { setSel(0); }, [q]);

  const pick = (m) => {
    setInput(renderPlain(m.template, m.mode));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: IT.bg }}>
      <ThreadHeader name="Karin VK3" sub="7b21d0 · DM" />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'flex-end' }}>
        <Bubble side="in" meta="14:32 · -84 dBm / 6.5 snr">Anyone near Mt Bonnell for a relay test?</Bubble>
      </div>

      <div style={{ flex: '0 0 auto', position: 'relative', padding: '12px 14px', borderTop: `1px solid ${IT.border}`, background: IT.bg2 }}>
        {/* popover */}
        {open && (
          <div style={{ position: 'absolute', left: 14, right: 14, bottom: 'calc(100% - 6px)', background: IT.bg2, border: `1px solid ${IT.borderStrong}`, borderRadius: 10, boxShadow: '0 14px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderBottom: `1px solid ${IT.border}` }}>
              <span style={{ color: IT.accent, display: 'inline-flex' }}>{React.createElement(IMI.braces, { size: 13 })}</span>
              <span style={{ fontSize: 11.5, color: IT.textMuted }}>Insert a macro</span>
              <span style={{ fontFamily: IMONO, fontSize: 10.5, color: IT.textDim }}>{matches.length}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: IMONO, fontSize: 9.5, color: IT.textDim }}>↑↓ · ⏎ insert</span>
            </div>
            <div style={{ maxHeight: 230, overflowY: 'auto', padding: 5 }}>
              {matches.length ? matches.map((m, i) => {
                const r = window.MAC_LIQUID.render(m.template, replyCtx, m.mode === 'send' ? 'send' : 'reply');
                return (
                  <div key={m.id} onMouseEnter={() => setSel(i)} onClick={() => pick(m)}
                    style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: i === sel ? IT.bg3 : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: IT.text }}>{m.name}</span>
                      <IScope scope={m.scope} label={m.scopeLabel} />
                      <div style={{ flex: 1 }} />
                      <span style={{ fontFamily: IMONO, fontSize: 9.5, color: r.length > window.MAC_MSG_LIMIT ? IT.danger : IT.textDim }}>{r.length}c</span>
                    </div>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><RenderedInline tpl={m.template} mode={m.mode} size={11.5} /></div>
                  </div>
                );
              }) : <div style={{ padding: '14px', textAlign: 'center', color: IT.textDim, fontSize: 12 }}>No macros match “{q}”.</div>}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9 }}>
          <div style={{ flex: 1, minHeight: 38, display: 'flex', alignItems: 'center', padding: '0 12px', background: IT.bg, border: `1px solid ${open ? IT.accent : IT.border}`, borderRadius: 9 }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} placeholder="Message…  (type / for macros)"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: IT.text, fontFamily: IFONT, fontSize: 13.5 }} />
            {open && <span style={{ fontFamily: IMONO, fontSize: 10, color: IT.textDim }}>macro</span>}
          </div>
          <IBtn variant="default" icon="send" title="Send" />
        </div>
        <div style={{ marginTop: 7, fontSize: 11, color: IT.textDim }}>
          Type <span style={{ fontFamily: IMONO, color: IT.textMuted }}>/</span> to pick a saved macro — it expands to the rendered text before you send. Clear the box and type <span style={{ fontFamily: IMONO, color: IT.textMuted }}>/</span> again to retry.
        </div>
      </div>
    </div>
  );
}

// ── B · Quick-reply menu ────────────────────────────────────────────────
function QuickReply() {
  const replyMacros = ID.examples.filter(m => m.mode === 'reply' || m.mode === 'both');
  const [menu, setMenu] = React.useState(true);
  const [sent, setSent] = React.useState(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: IT.bg }}>
      <ThreadHeader name="Karin VK3" sub="7b21d0 · DM" />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 18, justifyContent: 'flex-end' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <Bubble side="in" meta="14:32 · -84 dBm / 6.5 snr · 2 hops">Anyone near Mt Bonnell for a relay test?</Bubble>
            <button onClick={() => setMenu(o => !o)} title="Quick reply with a macro"
              style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 9px', marginBottom: 2, borderRadius: 7, border: `1px solid ${menu ? IT.accent : IT.border}`, background: menu ? IT.accentBg : IT.bg2, color: menu ? IT.accent : IT.textMuted, cursor: 'pointer', fontFamily: IFONT, fontSize: 11.5 }}>
              {React.createElement(IMI.bolt, { size: 12 })} Quick reply
            </button>
          </div>

          {menu && (
            <div style={{ marginTop: 10, width: 360, maxWidth: '100%', background: IT.bg2, border: `1px solid ${IT.borderStrong}`, borderRadius: 11, boxShadow: '0 16px 44px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderBottom: `1px solid ${IT.border}` }}>
                <span style={{ color: IT.accent, display: 'inline-flex' }}>{React.createElement(IMI.reply, { size: 13 })}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: IT.text }}>Reply with a macro</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontFamily: IMONO, fontSize: 9.5, color: IT.textDim }}>vs this message</span>
              </div>
              <div style={{ padding: 5 }}>
                {replyMacros.map(m => {
                  const r = window.MAC_LIQUID.render(m.template, replyCtx, 'reply');
                  return (
                    <button key={m.id} onClick={() => { setSent(r.plain); setMenu(false); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', borderRadius: 8, padding: '9px 10px', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = IT.bg3} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: IT.text }}>{m.name}</span>
                        <div style={{ flex: 1 }} />
                        <span style={{ fontFamily: IMONO, fontSize: 9.5, color: r.length > window.MAC_MSG_LIMIT ? IT.danger : IT.textDim }}>{r.length}c</span>
                      </div>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><RenderedInline tpl={m.template} mode="reply" size={12} /></div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {sent && (
            <div style={{ marginTop: 16 }}>
              <Bubble side="out" sent>{sent}</Bubble>
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: '0 0 auto', padding: '12px 14px', borderTop: `1px solid ${IT.border}`, background: IT.bg2, display: 'flex', gap: 9 }}>
        <div style={{ flex: 1, height: 38, display: 'flex', alignItems: 'center', padding: '0 12px', background: IT.bg, border: `1px solid ${IT.border}`, borderRadius: 9, color: IT.textDim, fontSize: 13 }}>Message…</div>
        <IBtn variant="secondary" icon="send" title="Send" />
      </div>
    </div>
  );
}

// ── C · Variable autocomplete inside the editor ─────────────────────────
function VarAutocomplete() {
  const [value, setValue] = React.useState('Heard you at {{sen');
  const taRef = React.useRef(null);
  const [sel, setSel] = React.useState(0);

  // detect a trailing, still-open {{ … with an optional partial identifier
  const m = value.match(/\{\{\s*([a-zA-Z_][\w.]*)?$/);
  const partial = m ? (m[1] || '') : null;
  const open = partial !== null;
  const matches = open ? ID.variables.filter(v => v.name.toLowerCase().includes(partial.toLowerCase())) : [];
  React.useEffect(() => { setSel(0); }, [partial]);

  const complete = (v) => {
    const next = value.replace(/\{\{\s*([a-zA-Z_][\w.]*)?$/, `{{ ${v.name} }}`);
    setValue(next);
    requestAnimationFrame(() => taRef.current && taRef.current.focus());
  };
  const focused = matches[sel];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: IT.bg, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ color: IT.accent, display: 'inline-flex' }}>{React.createElement(IMI.braces, { size: 15 })}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: IT.text }}>Variable autocomplete</span>
        <span style={{ fontSize: 11, color: IT.textDim }}>type <span style={{ fontFamily: IMONO, color: IT.textMuted }}>{'{{'}</span> in the editor</span>
      </div>

      <div style={{ position: 'relative' }}>
        <IEditor value={value} onChange={setValue} mode="reply" taRef={taRef} minHeight={84} />
        {open && (
          <div style={{ position: 'absolute', left: 14, top: 'calc(100% + 6px)', width: 340, background: IT.bg2, border: `1px solid ${IT.borderStrong}`, borderRadius: 10, boxShadow: '0 14px 40px rgba(0,0,0,0.5)', overflow: 'hidden', zIndex: 5, display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0, maxHeight: 244, overflowY: 'auto', padding: 5 }}>
              {matches.length ? matches.map((v, i) => (
                <div key={v.name} onMouseEnter={() => setSel(i)} onClick={() => complete(v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: i === sel ? IT.bg3 : 'transparent' }}>
                  <span style={{ flex: '0 0 auto', fontFamily: IMONO, fontSize: 12, color: v.group === 'reply' ? IT.text : IT.accent, whiteSpace: 'nowrap' }}>{v.name}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontFamily: IMONO, fontSize: 9, color: IT.textDim, border: `1px solid ${IT.border}`, borderRadius: 3, padding: '0 4px' }}>{v.group === 'reply' ? 'reply' : 'always'}</span>
                </div>
              )) : <div style={{ padding: 12, textAlign: 'center', color: IT.textDim, fontSize: 12 }}>No variables match.</div>}
            </div>
            {/* HoverCard preview of the focused variable */}
            {focused && (
              <div style={{ flex: '0 0 138px', width: 138, borderLeft: `1px solid ${IT.border}`, padding: '10px 11px', background: IT.bg }}>
                <div style={{ fontFamily: IMONO, fontSize: 11, color: IT.accent, marginBottom: 5, wordBreak: 'break-all' }}>{focused.name}</div>
                <div style={{ fontSize: 11, color: IT.textMuted, lineHeight: 1.4, marginBottom: 8 }}>{focused.desc}</div>
                <div style={{ fontFamily: IMONO, fontSize: 9.5, color: IT.textDim, marginBottom: 2 }}>SAMPLE</div>
                <div style={{ fontFamily: IMONO, fontSize: 11, color: IT.text, wordBreak: 'break-word' }}>{focused.sample}</div>
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ marginTop: open ? 150 : 16, fontSize: 11.5, color: IT.textDim, lineHeight: 1.5 }}>
        As you type a variable name, matches surface in a popover with a live
        sample on hover. <span style={{ fontFamily: IMONO, color: IT.textMuted }}>⏎</span> completes the closest match and closes the braces.
      </div>
    </div>
  );
}

window.MacInContext = { ComposerAutocomplete, QuickReply, VarAutocomplete };
