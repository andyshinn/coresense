// mac-ui.jsx — shared inline-styled primitives for the Macros tool.
// All consume window.MAC_T. Mirrors the shadcn-flavored look used elsewhere
// in CoreSense (radius 7/8, amber primary, mono for telemetry).
const MT = window.MAC_T, MFONT = window.MAC_FONT, MMONO = window.MAC_MONO;
const MI = window.MacIcons;

// One-time CSS for the editor overlay + scrollbars + wavy error underline.
if (typeof document !== 'undefined' && !document.getElementById('mac-css')) {
  const s = document.createElement('style');
  s.id = 'mac-css';
  s.textContent = `
    .mac-scope ::-webkit-scrollbar{width:9px;height:9px}
    .mac-scope ::-webkit-scrollbar-thumb{background:${MT.border};border-radius:6px;border:2px solid transparent;background-clip:content-box}
    .mac-scope ::-webkit-scrollbar-thumb:hover{background:${MT.borderStrong}}
    .mac-scope ::-webkit-scrollbar-track{background:transparent}
    .mac-err-underline{text-decoration:underline wavy ${MT.danger};text-decoration-skip-ink:none;text-underline-offset:3px}
    .mac-warn-underline{text-decoration:underline wavy ${MT.warn};text-decoration-skip-ink:none;text-underline-offset:3px}
    .mac-blink{animation:macBlink 1.1s steps(1) infinite}
    @keyframes macBlink{0%,50%{opacity:1}50.01%,100%{opacity:0}}
  `;
  document.head.appendChild(s);
}

function useCopy(timeout = 1300) {
  const [copied, setCopied] = React.useState(false);
  const t = React.useRef(0);
  const copy = React.useCallback((text) => {
    try { navigator.clipboard?.writeText(text); } catch {}
    setCopied(true); clearTimeout(t.current);
    t.current = setTimeout(() => setCopied(false), timeout);
  }, [timeout]);
  return [copied, copy];
}

const Dot = ({ color, size = 7 }) => (
  <span style={{ width: size, height: size, borderRadius: size, background: color, flex: '0 0 auto', display: 'inline-block' }} />
);

const Eyebrow = ({ children, color = MT.textDim, style }) => (
  <div style={{ fontFamily: MMONO, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color, ...style }}>{children}</div>
);

function Btn({ variant = 'outline', size = 'default', icon, iconRight, children, onClick, full, title, active }) {
  const [hover, setHover] = React.useState(false);
  const sm = size === 'sm', xs = size === 'xs';
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
    height: xs ? 26 : sm ? 30 : 34, padding: xs ? '0 9px' : sm ? '0 11px' : '0 14px',
    borderRadius: 7, cursor: 'pointer', fontFamily: MFONT, fontSize: xs ? 12 : sm ? 12.5 : 13,
    fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap', border: '1px solid transparent',
    transition: 'background .14s, border-color .14s, color .14s', width: full ? '100%' : 'auto',
  };
  const v = {
    default:   { background: hover ? '#fbb024' : MT.accent, color: '#1a1206', fontWeight: 600 },
    secondary: { background: hover ? MT.bg4 : MT.bg3, color: MT.text },
    outline:   { background: hover || active ? MT.bg3 : 'transparent', color: MT.text, borderColor: active ? MT.borderStrong : MT.border },
    ghost:     { background: hover ? MT.bg3 : 'transparent', color: hover ? MT.text : MT.textMuted },
    destructive:{ background: hover ? MT.dangerBg : 'transparent', color: hover ? MT.danger : MT.textMuted, borderColor: hover ? 'rgba(239,68,68,0.4)' : MT.border },
  }[variant];
  return (
    <button title={title} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ ...base, ...v }}>
      {icon ? React.createElement(MI[icon], { size: xs ? 12 : sm ? 13 : 14 }) : null}
      {children}
      {iconRight ? React.createElement(MI[iconRight], { size: xs ? 12 : sm ? 13 : 14 }) : null}
    </button>
  );
}

function Badge({ variant = 'secondary', children, dot, mono = true }) {
  const v = {
    secondary: { background: MT.bg3, color: MT.textMuted, border: `1px solid ${MT.border}` },
    outline:   { background: 'transparent', color: MT.textMuted, border: `1px solid ${MT.border}` },
    accent:    { background: MT.accentBg, color: MT.accent, border: `1px solid ${MT.accentSoft}` },
    online:    { background: 'rgba(132,204,22,0.10)', color: MT.online, border: '1px solid rgba(132,204,22,0.28)' },
    warn:      { background: MT.warnBg, color: MT.warn, border: '1px solid rgba(245,158,11,0.30)' },
    danger:    { background: MT.dangerBg, color: MT.danger, border: '1px solid rgba(239,68,68,0.30)' },
  }[variant];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px', borderRadius: 5, fontFamily: mono ? MMONO : MFONT, fontSize: 10.5, fontWeight: 600, letterSpacing: 0.2, lineHeight: 1.5, whiteSpace: 'nowrap', ...v }}>
      {dot ? <Dot color={v.color} size={5} /> : null}
      {children}
    </span>
  );
}

const Separator = ({ vertical, style }) => (
  <div style={vertical ? { width: 1, alignSelf: 'stretch', background: MT.border, ...style } : { height: 1, background: MT.border, ...style }} />
);

const Card = ({ children, style }) => (
  <div style={{ background: MT.bg2, border: `1px solid ${MT.border}`, borderRadius: 10, ...style }}>{children}</div>
);

// Segmented control (shadcn Tabs / ToggleGroup feel).
function Segmented({ value, onChange, options, size = 'default' }) {
  const h = size === 'sm' ? 28 : 32;
  return (
    <div role="tablist" style={{ display: 'inline-flex', gap: 3, background: MT.bg, border: `1px solid ${MT.border}`, borderRadius: 8, padding: 3 }}>
      {options.map((o) => {
        const val = typeof o === 'object' ? o.value : o;
        const label = typeof o === 'object' ? o.label : o;
        const ic = typeof o === 'object' ? o.icon : null;
        const on = value === val;
        return (
          <button key={val} role="tab" aria-selected={on} onClick={() => onChange(val)}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: h, padding: '0 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: MFONT, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', transition: 'background .14s,color .14s', background: on ? MT.bg3 : 'transparent', color: on ? MT.text : MT.textMuted, boxShadow: on ? `inset 0 0 0 1px ${MT.border}` : 'none' }}>
            {ic ? React.createElement(MI[ic], { size: 13 }) : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Scope tag — global / per-channel / per-contact, with icon.
function ScopeTag({ scope, label }) {
  const map = {
    global:  { icon: 'globe', text: 'Global', color: MT.textMuted },
    channel: { icon: 'hash',  text: label || 'Channel', color: MT.accent },
    contact: { icon: 'user',  text: label || 'Contact', color: MT.online },
  };
  const m = map[scope] || map.global;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: MFONT, fontSize: 11.5, color: m.color }}>
      <span style={{ display: 'inline-flex', opacity: 0.9 }}>{React.createElement(MI[m.icon], { size: 12 })}</span>
      {m.text}
    </span>
  );
}

// Mode chip — reply / send / both.
function ModeChip({ mode }) {
  const m = {
    reply: { icon: 'reply', label: 'Reply', variant: 'accent' },
    send:  { icon: 'send',  label: 'New send', variant: 'secondary' },
    both:  { icon: 'bolt',  label: 'Any', variant: 'outline' },
  }[mode] || { icon: 'bolt', label: mode, variant: 'secondary' };
  return <Badge variant={m.variant} mono={false}><span style={{ display: 'inline-flex', marginRight: 1 }}>{React.createElement(MI[m.icon], { size: 11 })}</span>{m.label}</Badge>;
}

// Type tag for the variable reference list.
function TypeTag({ kind }) {
  const labels = { id: 'id', text: 'str', num: 'num', pos: 'pos', time: 'time', array: 'arr' };
  return <span style={{ fontFamily: MMONO, fontSize: 9, color: MT.textDim, border: `1px solid ${MT.border}`, borderRadius: 3, padding: '0 4px', lineHeight: '14px', flex: '0 0 auto' }}>{labels[kind] || kind}</span>;
}

window.MacUI = { MT, MFONT, MMONO, MI, useCopy, Dot, Eyebrow, Btn, Badge, Separator, Card, Segmented, ScopeTag, ModeChip, TypeTag };
