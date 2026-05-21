// SettingsPanel — the redesigned MeshCore settings surface.
//
//   <SettingsPanel theme={t} tab="app"|"radio" connected={true|false} />
//
// Layout:
//   ┌───────────────────────────────────────────────────────────┐
//   │  Settings                                  · status pill   │
//   │  [ Application Settings ] [ Radio Settings ]               │
//   ├───────────────────────────────────────────────────────────┤
//   │                                            │ ON THIS PAGE  │
//   │  ── Section ──────────────────────────     │  Appearance   │
//   │  ┌─ icon · Title ─────────[Unsaved][Save]  │  Composer     │
//   │  │  Row label                  [control]   │  Notifications│
//   │  │  Row label · description    [control]   │  …            │
//   │                                            │               │
//   └───────────────────────────────────────────────────────────┘
//
// Per-section Save: each section in MC_SETTINGS may carry a `dirty` flag.
// When true the Save button is shown in its primary/accent treatment with
// a small "Unsaved" badge next to the section title. When false the button
// is rendered in its ghost/resting treatment, disabled — so the affordance
// is always visible but only actionable when there's something to save.
//
// Radio tab + connected=false: top of the panel shows a banner with a
// Connect CTA; every row is rendered with `disabled` to dim the control
// and suppress interaction.

// ─── Icon set (12–14px stroked) ──────────────────────────────────────
function Icon({ name, size = 14, t }) {
  const props = {
    width: size, height: size, viewBox: '0 0 16 16',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    case 'sun':     return <svg {...props}><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3"/></svg>;
    case 'send':    return <svg {...props}><path d="M2 8l11-5-4 11-2-5z"/></svg>;
    case 'bell':    return <svg {...props}><path d="M4 11v-4a4 4 0 1 1 8 0v4M2.5 11h11M7 13a1 1 0 0 0 2 0"/></svg>;
    case 'wifi':    return <svg {...props}><path d="M1.5 6.5C4 4 7 3 8 3s4 1 6.5 3.5M3.5 9C5 7.5 7 7 8 7s3 .5 4.5 2"/><circle cx="8" cy="12" r="0.7" fill="currentColor" stroke="none"/></svg>;
    case 'sliders': return <svg {...props}><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.2" fill={t?.bg || '#fff'}/><circle cx="10" cy="8" r="1.2" fill={t?.bg || '#fff'}/><circle cx="6" cy="12" r="1.2" fill={t?.bg || '#fff'}/></svg>;
    case 'map':     return <svg {...props}><path d="M2 4l4-1 4 1 4-1v10l-4 1-4-1-4 1z"/><path d="M6 3v11M10 4v11"/></svg>;
    case 'user':    return <svg {...props}><circle cx="8" cy="6" r="2.5"/><path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4"/></svg>;
    case 'radio':   return <svg {...props}><circle cx="8" cy="8" r="1.5"/><path d="M5 5C3 6 3 10 5 11M11 5c2 1 2 5 0 6M3.5 3.5C1 5 1 11 3.5 12.5M12.5 3.5C15 5 15 11 12.5 12.5"/></svg>;
    case 'key':     return <svg {...props}><circle cx="5" cy="11" r="2.5"/><path d="M7 9l6-6M11 5l1.5 1.5M13 3l1.5 1.5"/></svg>;
    case 'bt':      return <svg {...props}><path d="M5 4l6 8-3 2V2l3 2-6 8"/></svg>;
    case 'contact': return <svg {...props}><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6.5" cy="7.5" r="1.5"/><path d="M4 11.5c0-1 1-2 2.5-2s2.5 1 2.5 2M10 6h2.5M10 9h2"/></svg>;
    case 'info':    return <svg {...props}><circle cx="8" cy="8" r="6.5"/><path d="M8 7v4M8 5v.5"/></svg>;
    case 'plug':    return <svg {...props}><path d="M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0z M8 12v2.5"/></svg>;
    case 'cog':     return <svg {...props}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></svg>;
    default: return <span style={{ width: size, height: size, display: 'inline-block' }}/>;
  }
}

// ─── One row: label + optional description + warning + control ──────
function SettingsRow({ row, t, disabled }) {
  const c = row.ctrl;
  const ctrlDisabled = disabled || c.disabled;
  let control;
  switch (c.kind) {
    case 'toggle': control = <Toggle checked={c.value} disabled={ctrlDisabled} t={t} />; break;
    case 'select': control = <Select value={c.value} options={c.options} width={c.width} disabled={ctrlDisabled} t={t} />; break;
    case 'number': control = <NumberInput value={c.value} suffix={c.suffix} width={c.width} disabled={ctrlDisabled} t={t} />; break;
    case 'text':   control = <TextInput value={c.value} mono={c.mono} width={c.width} disabled={ctrlDisabled} t={t} />; break;
    case 'button': control = <Button kind={c.danger ? 'danger' : 'secondary'} disabled={ctrlDisabled} t={t}>{c.label}</Button>; break;
    default: control = null;
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 16,
      padding: '12px 0',
      opacity: disabled ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: t.text, lineHeight: 1.35 }}>
          {row.label}
        </div>
        {row.desc && (
          <div style={{
            fontSize: 11.5, color: t.textDim, lineHeight: 1.4,
            marginTop: 2, maxWidth: 360,
          }}>{row.desc}</div>
        )}
        {row.warning && (
          <div style={{
            fontSize: 11, color: t.warn, marginTop: 4,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round">
              <path d="M8 2L1.5 13h13z M8 6v3M8 11v.5"/>
            </svg>
            {row.warning}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, paddingTop: 1 }}>{control}</div>
    </div>
  );
}

// ─── One section: header (icon + title + dirty/Save) + rows + footnote
function SettingsSection({ section, t, disabled, isFirst }) {
  return (
    <section data-section={section.id} style={{ scrollMarginTop: 16 }}>
      {!isFirst && <div style={{ height: 1, background: t.border, margin: '20px 0 18px' }}/>}
      <header style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        marginBottom: section.description ? 4 : 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            margin: 0, fontSize: 15, fontWeight: 600,
            color: t.text, letterSpacing: -0.1,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: t.accent, display: 'inline-flex' }}>
              <Icon name={section.icon} size={14} t={t}/>
            </span>
            {section.title}
          </h2>
          {section.description && (
            <p style={{
              margin: '4px 0 0', fontSize: 12, color: t.textMuted,
              lineHeight: 1.45, maxWidth: 460,
            }}>{section.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {section.dirty && <DirtyBadge t={t}/>}
          <Button
            kind={section.dirty ? 'primary' : 'ghost'}
            size="sm"
            disabled={disabled || !section.dirty}
            t={t}>Save</Button>
        </div>
      </header>
      <div style={{ marginTop: 6 }}>
        {section.rows.map((row, i) => (
          <div key={i} style={{ borderTop: i ? `1px solid ${t.border}` : 'none' }}>
            <SettingsRow row={row} t={t} disabled={disabled}/>
          </div>
        ))}
      </div>
      {section.footnote && (
        <p style={{ margin: '8px 0 0', fontSize: 11, fontStyle: 'italic', color: t.textDim }}>
          {section.footnote}
        </p>
      )}
    </section>
  );
}

// ─── Right rail: "ON THIS PAGE" jump list with active marker ────────
function JumpRail({ sections, t, active }) {
  return (
    <nav aria-label="Jump to section" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{
        fontFamily: window.MC_MONO, fontSize: 9.5, color: t.textDim,
        letterSpacing: 0.6, padding: '0 0 8px',
      }}>ON THIS PAGE</div>
      {sections.map(s => {
        const on = s.id === active;
        return (
          <span key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 0 4px 10px',
            borderLeft: `2px solid ${on ? t.accent : 'transparent'}`,
            fontSize: 12,
            fontWeight: on ? 600 : 400,
            color: on ? t.text : t.textMuted,
            cursor: 'pointer',
          }}>
            {s.title}
            {s.dirty && (
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: t.warn, display: 'inline-block',
              }}/>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ─── Main shell ──────────────────────────────────────────────────────
function SettingsPanel({ theme, tab = 'app', connected = true }) {
  const t = theme;
  const sections = window.MC_SETTINGS[tab];
  // First section is "in view" — drives the rail highlight.
  const activeSec = sections[0].id;
  const disabled = tab === 'radio' && !connected;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: t.bg, color: t.text,
      fontFamily: window.MC_FONT,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header: title + segmented tabs + status pill */}
      <div style={{
        flexShrink: 0,
        padding: '20px 28px 14px',
        borderBottom: `1px solid ${t.border}`,
        background: t.bg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <h1 style={{
            margin: 0, fontSize: 17, fontWeight: 700,
            color: t.text, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: t.accent }}><Icon name="cog" size={16} t={t}/></span>
            Settings
          </h1>
          <div style={{ flex: 1 }}/>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 16,
        }}>
          <PillTabs
            tabs={[
              { id: 'app',   label: 'Application Settings', icon: <Icon name="cog" size={12} t={t}/> },
              { id: 'radio', label: 'Radio Settings',       icon: <Icon name="radio" size={12} t={t}/> },
            ]}
            active={tab}
            t={t}
          />
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 11.5, color: t.textMuted,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: connected ? t.online : t.textDim,
              boxShadow: connected ? `0 0 0 3px ${t.accentBg}` : 'none',
            }}/>
            {tab === 'radio'
              ? (connected ? 'egrme.sh Hand · USB' : 'No radio connected')
              : 'Local · auto-saved'}
          </span>
        </div>
      </div>

      {/* Body: scrolling content + sticky right rail */}
      <div style={{
        flex: 1, minHeight: 0, display: 'flex',
        overflow: 'hidden',
      }}>
        <div style={{
          flex: 1, minWidth: 0, overflow: 'auto',
          padding: '20px 28px 28px',
        }}>
          {disabled && (
            <div style={{ marginBottom: 16 }}>
              <Banner
                t={t}
                icon={
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2L1.5 13h13z M8 6v4M8 12v.5"/>
                  </svg>
                }
                title="No radio connected"
                body="These settings are stored on the radio. Connect a device to view and edit live values."
                action={
                  <Button kind="primary" size="md" t={t}
                    leadingIcon={<Icon name="plug" size={12} t={t}/>}>
                    Connect radio…
                  </Button>
                }
              />
            </div>
          )}
          {sections.map((s, i) => (
            <SettingsSection
              key={s.id}
              section={s}
              t={t}
              disabled={disabled}
              isFirst={i === 0}
            />
          ))}
        </div>
        <aside style={{
          width: 188,
          flexShrink: 0,
          padding: '20px 24px 28px 4px',
          borderLeft: `1px solid ${t.border}`,
          background: t.bg,
          overflow: 'auto',
        }}>
          <JumpRail sections={sections} t={t} active={activeSec}/>
        </aside>
      </div>
    </div>
  );
}

window.SettingsPanel = SettingsPanel;
