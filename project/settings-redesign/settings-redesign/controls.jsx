// Shared form-control primitives for the MeshCore settings panel mock.
// Pure-visual — no real state. Pass `value`/`checked` to render; `disabled`
// to gray-out (used by the no-radio banner state).
//
// All controls accept a `t` theme prop so the same component renders in
// light & dark side-by-side without a CSS variable round-trip.

const { useState } = React;

// ─── Toggle ──────────────────────────────────────────────────────────
function Toggle({ checked, disabled, t, size = 'md' }) {
  const w = size === 'sm' ? 28 : 32;
  const h = size === 'sm' ? 16 : 18;
  const k = size === 'sm' ? 12 : 14;
  return (
    <span
      role="switch"
      aria-checked={checked}
      style={{
        display: 'inline-block',
        width: w,
        height: h,
        borderRadius: h,
        background: checked ? t.accent : t.bg3,
        border: `1px solid ${checked ? t.accent : t.border}`,
        position: 'relative',
        transition: 'background 0.15s, border-color 0.15s',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}>
      <span style={{
        position: 'absolute',
        top: 1,
        left: checked ? w - k - 3 : 2,
        width: k,
        height: k,
        borderRadius: '50%',
        background: t.mode === 'dark' && !checked ? t.text : '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: 'left 0.15s',
      }}/>
    </span>
  );
}

// ─── Select ──────────────────────────────────────────────────────────
function Select({ value, options, disabled, t, mono, width = 220 }) {
  const opt = options.find(o => o.value === value) || options[0];
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 8px 5px 10px',
      width,
      background: t.controlBg,
      border: `1px solid ${t.controlBorder}`,
      borderRadius: 5,
      color: disabled ? t.textDim : t.text,
      fontSize: 12.5,
      fontFamily: mono ? window.MC_MONO : 'inherit',
      opacity: disabled ? 0.6 : 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      justifyContent: 'space-between',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {opt.label}
      </span>
      <svg width="9" height="9" viewBox="0 0 11 11" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" style={{ opacity: 0.55, flexShrink: 0 }}>
        <path d="M2 4l3.5 3.5L9 4"/>
      </svg>
    </span>
  );
}

// ─── NumberInput ─────────────────────────────────────────────────────
function NumberInput({ value, suffix, disabled, t, width = 88 }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      width,
      background: t.controlBg,
      border: `1px solid ${t.controlBorder}`,
      borderRadius: 5,
      color: disabled ? t.textDim : t.text,
      fontSize: 12.5,
      fontFamily: window.MC_MONO,
      opacity: disabled ? 0.6 : 1,
      cursor: disabled ? 'not-allowed' : 'text',
      overflow: 'hidden',
    }}>
      <span style={{ padding: '5px 8px', flex: 1, textAlign: 'right' }}>{value}</span>
      {suffix && (
        <span style={{
          fontFamily: window.MC_MONO,
          fontSize: 11,
          color: t.textDim,
          padding: '5px 8px',
          borderLeft: `1px solid ${t.border}`,
          background: t.bg2,
        }}>{suffix}</span>
      )}
    </span>
  );
}

// ─── TextInput ───────────────────────────────────────────────────────
function TextInput({ value, placeholder, disabled, t, mono, width = 280 }) {
  return (
    <span style={{
      display: 'inline-block',
      width,
      padding: '5px 8px',
      background: t.controlBg,
      border: `1px solid ${t.controlBorder}`,
      borderRadius: 5,
      color: disabled ? t.textDim : t.text,
      fontSize: 12.5,
      fontFamily: mono ? window.MC_MONO : 'inherit',
      opacity: disabled ? 0.6 : 1,
      cursor: disabled ? 'not-allowed' : 'text',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}>
      {value || <span style={{ color: t.textDim }}>{placeholder}</span>}
    </span>
  );
}

// ─── Button ──────────────────────────────────────────────────────────
function Button({ kind = 'secondary', size = 'md', disabled, t, children, leadingIcon }) {
  const sizes = {
    sm: { pad: '3px 8px', fs: 11.5 },
    md: { pad: '5px 12px', fs: 12.5 },
  };
  const sz = sizes[size];
  let bg, fg, border;
  if (kind === 'primary') {
    bg = t.accent; fg = t.mode === 'dark' ? '#1c1810' : '#fff'; border = t.accent;
  } else if (kind === 'ghost') {
    bg = 'transparent'; fg = t.text; border = 'transparent';
  } else if (kind === 'danger') {
    bg = 'transparent'; fg = t.danger; border = t.border;
  } else {
    bg = t.bg2; fg = t.text; border = t.border;
  }
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: sz.pad,
      fontSize: sz.fs,
      fontWeight: kind === 'primary' ? 600 : 500,
      background: bg,
      color: fg,
      border: `1px solid ${border}`,
      borderRadius: 5,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
    }}>
      {leadingIcon}
      {children}
    </span>
  );
}

// ─── DirtyBadge ─────────────────────────────────────────────────────
function DirtyBadge({ t, label = 'Unsaved' }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 7px',
      fontSize: 10.5,
      fontFamily: window.MC_MONO,
      letterSpacing: 0.3,
      color: t.warn,
      background: t.accentBg,
      border: `1px solid ${t.bannerBorder}`,
      borderRadius: 3,
      textTransform: 'uppercase',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: t.warn, display: 'inline-block',
      }}/>
      {label}
    </span>
  );
}

// ─── Banner (disconnected, etc.) ────────────────────────────────────
function Banner({ t, icon, title, body, action }) {
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      padding: '12px 14px',
      background: t.bannerBg,
      border: `1px solid ${t.bannerBorder}`,
      borderRadius: 6,
      fontFamily: window.MC_FONT,
    }}>
      {icon && <div style={{ color: t.warn, flexShrink: 0, marginTop: 1 }}>{icon}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 2 }}>{title}</div>
        {body && <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.45 }}>{body}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

// ─── PillTabs (segmented) ───────────────────────────────────────────
function PillTabs({ tabs, active, t }) {
  return (
    <div role="tablist" style={{
      display: 'inline-flex',
      padding: 3,
      background: t.bg3,
      border: `1px solid ${t.border}`,
      borderRadius: 7,
      gap: 2,
    }}>
      {tabs.map(tab => {
        const on = tab.id === active;
        return (
          <span key={tab.id} role="tab" aria-selected={on} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '5px 14px',
            fontSize: 12.5,
            fontWeight: on ? 600 : 500,
            color: on ? (t.mode === 'dark' ? '#1c1810' : '#fff') : t.textMuted,
            background: on ? t.accent : 'transparent',
            borderRadius: 5,
            cursor: 'pointer',
            transition: 'background 0.12s',
            whiteSpace: 'nowrap',
          }}>
            {tab.icon}
            {tab.label}
          </span>
        );
      })}
    </div>
  );
}

Object.assign(window, {
  Toggle, Select, NumberInput, TextInput, Button, DirtyBadge, Banner, PillTabs,
});
