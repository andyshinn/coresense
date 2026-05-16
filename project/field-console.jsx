// Direction 2: Field Console — iteration 2
// Changes from v1:
//  - Channel types: Public (no #), Hashtag (#), Private (lock) — distinct prefix icons
//  - Add (+) button next to "CHANNELS" and "CONTACTS"
//  - Contact types: Chat, Repeater, Sensor, Room Server — typed prefix icons
//  - Removed repeater info from channels (now lives in RX/Packet Log)
//  - Removed right peer pane → message-info popover on click (path, hops, RSSI per hop)
//  - Added "Packet Log" entry (special channel-like view, monospace RX/TX feed)
//  - Footer status block now opens a Connection menu (USB/BLE/TCP + connect/change/disconnect)
//  - Settings button in sidebar header

const FC_THEMES = {
  dark: {
    bg: '#0c0a06', bg2: '#13110b', bg3: '#1a1610', bg4: '#221c12',
    border: '#2a2419', borderStrong: '#3a3322',
    text: '#f5f1e6', textMuted: '#a39884', textDim: '#6b6253',
    accent: '#f59e0b', accentDim: '#b45309', accentBg: 'rgba(245,158,11,0.10)',
    online: '#84cc16', warn: '#f59e0b', danger: '#dc2626',
    chip: '#1c1810',
  },
  light: {
    bg: '#fbf9f3', bg2: '#f5f1e6', bg3: '#ede7d6', bg4: '#e2dac1',
    border: '#dcd4be', borderStrong: '#c4ba9f',
    text: '#1c1810', textMuted: '#5c5340', textDim: '#8a8067',
    accent: '#b45309', accentDim: '#92400e', accentBg: 'rgba(180,83,9,0.08)',
    online: '#65a30d', warn: '#b45309', danger: '#b91c1c',
    chip: '#ede7d6',
  },
};

const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace';

// ── Channel/contact types ───────────────────────────────────────────
// Channel types: 'public' (no prefix), 'hashtag' (#), 'private' (lock)
// Contact types: 'chat', 'repeater', 'sensor', 'room'

function FCChannelGlyph({ type, theme, size = 12 }) {
  const c = theme.textDim;
  if (type === 'public') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M2 8h12 M8 2c2.2 2 2.2 10 0 12 M8 2c-2.2 2 -2.2 10 0 12" />
      </svg>
    );
  }
  if (type === 'private') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5">
        <rect x="3" y="7" width="10" height="7" rx="1.2" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" />
      </svg>
    );
  }
  // hashtag
  return <span style={{ fontFamily: MONO, fontSize: 12, color: c, lineHeight: 1, width: size, display: 'inline-block', textAlign: 'center' }}>#</span>;
}

function FCContactGlyph({ type, theme, size = 12 }) {
  const c = theme.textDim;
  if (type === 'repeater') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5">
        <path d="M3 13l3-9 M13 13l-3-9 M5 9h6" />
        <circle cx="8" cy="6.5" r="0.9" fill={c} stroke="none" />
      </svg>
    );
  }
  if (type === 'sensor') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5">
        <path d="M3 11a5 5 0 0 1 10 0" />
        <path d="M5.5 11a2.5 2.5 0 0 1 5 0" />
        <circle cx="8" cy="11" r="0.9" fill={c} stroke="none" />
      </svg>
    );
  }
  if (type === 'room') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5">
        <rect x="2" y="3" width="12" height="5" rx="1" />
        <rect x="2" y="9" width="12" height="4" rx="1" />
        <circle cx="4.5" cy="5.5" r="0.5" fill={c} stroke="none" />
        <circle cx="4.5" cy="11" r="0.5" fill={c} stroke="none" />
      </svg>
    );
  }
  // chat (1:1, e2e)
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="1.5">
      <path d="M3 6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H7l-3 2v-2a3 3 0 0 1-1-2.5z" />
    </svg>
  );
}

function FCRssiChip({ rssi, hops, theme }) {
  const bars = rssi > -75 ? 4 : rssi > -85 ? 3 : rssi > -95 ? 2 : 1;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '1px 5px',
      background: theme.bg3, borderRadius: 3, fontFamily: MONO, fontSize: 10,
      color: theme.textMuted, border: `1px solid ${theme.border}`,
    }}>
      <span style={{ display: 'inline-flex', gap: 1, alignItems: 'flex-end', height: 9 }}>
        {[1,2,3,4].map(i => (
          <span key={i} style={{
            width: 2, height: 2 + i*1.6,
            background: i <= bars ? theme.accent : theme.border,
          }} />
        ))}
      </span>
      <span>{rssi}</span>
      <span style={{ color: theme.textDim }}>·</span>
      <span>{hops}h</span>
    </span>
  );
}

function FCFmtTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h`;
  return `${Math.floor(seconds/86400)}d`;
}

// ── Channel data shape (typed) ──────────────────────────────────────
// We extend the shared channels with explicit `type`. Public has no #;
// hashtag channels keep the '#' as data, not display chrome.
function fcChannels() {
  return [
    { type: 'public',  name: 'Public',           unread: 3, active: false },
    { type: 'hashtag', name: 'meshcore',         unread: 0, active: true  },
    { type: 'hashtag', name: 'meetup',           unread: 1 },
    { type: 'hashtag', name: 'testing',          unread: 0 },
    { type: 'hashtag', name: 'backontheroof',    unread: 0 },
    { type: 'hashtag', name: 'meshwx-discover',  unread: 0 },
    { type: 'private', name: 'soco-ops',         unread: 2 },
    { type: 'private', name: 'family',           unread: 0 },
  ];
}

function fcContacts() {
  return [
    { type: 'chat',     name: 'Ave Maritza-M',     hops: 2, lastSeen: 120, rssi: -72 },
    { type: 'chat',     name: 'FLO1',              hops: 1, lastSeen: 720, rssi: -55 },
    { type: 'chat',     name: 'Picassoman-M',      hops: 4, lastSeen: 10800, rssi: -98, stale: true },
    { type: 'repeater', name: 'SOCO Meshcore RAK', hops: 1, lastSeen: 12, rssi: -68 },
    { type: 'repeater', name: 'Cedar Park Repeater', hops: 2, lastSeen: 240, rssi: -88 },
    { type: 'repeater', name: 'Bender DT',         hops: 1, lastSeen: 60, rssi: -94 },
    { type: 'sensor',   name: 'WX-Roof',           hops: 1, lastSeen: 180, rssi: -76 },
    { type: 'sensor',   name: 'BatHouse 12V',      hops: 2, lastSeen: 900, rssi: -91 },
    { type: 'room',     name: 'SOCO Room Server',  hops: 1, lastSeen: 30, rssi: -70 },
    { type: 'room',     name: 'ATX Mesh Lounge',   hops: 2, lastSeen: 720, rssi: -82 },
  ];
}

// ── Sidebar section header with + add button ────────────────────────
function FCSectionHeader({ label, theme, onAdd, popover, onTogglePopover }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 8px 4px', position: 'relative',
    }}>
      <span style={{
        fontFamily: MONO, fontSize: 10, color: theme.textDim, letterSpacing: 0.5,
      }}>{label}</span>
      <button onClick={onTogglePopover} style={{
        width: 16, height: 16, padding: 0, border: 'none', background: 'transparent',
        color: theme.textDim, cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', borderRadius: 2,
      }}
        onMouseEnter={(e) => { e.currentTarget.style.background = theme.bg3; e.currentTarget.style.color = theme.accent; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textDim; }}
        title={`Add ${label.toLowerCase()}`}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2v8M2 6h8" /></svg>
      </button>
      {popover}
    </div>
  );
}

// ── Add Channel popover ─────────────────────────────────────────────
function FCAddChannelPopover({ theme, onClose }) {
  const Item = ({ glyph, title, subtitle }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      borderRadius: 4, cursor: 'pointer',
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = theme.bg3}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <div style={{
        width: 22, height: 22, borderRadius: 4, background: theme.bg3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${theme.border}`,
      }}>{glyph}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: theme.text, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 10.5, color: theme.textDim }}>{subtitle}</div>
      </div>
    </div>
  );
  return (
    <div style={{
      position: 'absolute', top: 22, right: 4, zIndex: 50, width: 256,
      background: theme.bg2, border: `1px solid ${theme.borderStrong}`,
      borderRadius: 5, boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
      padding: 4,
    }}>
      <div style={{ padding: '6px 10px', fontFamily: MONO, fontSize: 9, color: theme.textDim, letterSpacing: 0.5 }}>ADD CHANNEL</div>
      <Item glyph={<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={theme.text} strokeWidth="1.5"><path d="M6 2v8M2 6h8"/></svg>}
        title="Create private channel" subtitle="Generate a new shared key" />
      <Item glyph={<FCChannelGlyph type="private" theme={{ ...theme, textDim: theme.text }} />}
        title="Join private channel" subtitle="Paste a shared key" />
      <Item glyph={<FCChannelGlyph type="public" theme={{ ...theme, textDim: theme.text }} />}
        title="Join public channel" subtitle="Anyone in range" />
      <Item glyph={<FCChannelGlyph type="hashtag" theme={{ ...theme, textDim: theme.text }} />}
        title="Join hashtag channel" subtitle="Open, name-keyed" />
      <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />
      <Item glyph={<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={theme.text} strokeWidth="1.5"><rect x="2" y="2" width="5" height="5" rx="0.5"/><rect x="9" y="2" width="5" height="5" rx="0.5"/><rect x="2" y="9" width="5" height="5" rx="0.5"/><path d="M9 9h2v2 M13 9v2 M9 13h2 M13 13h1"/></svg>}
        title="Scan QR" subtitle="From another device" />
    </div>
  );
}

// ── Add Contact popover ─────────────────────────────────────────────
function FCAddContactPopover({ theme, onClose }) {
  const types = [
    { type: 'chat', label: 'Chat', sub: '1:1 end-to-end' },
    { type: 'repeater', label: 'Repeater', sub: 'Relay node' },
    { type: 'sensor', label: 'Sensor', sub: 'Telemetry source' },
    { type: 'room', label: 'Room Server', sub: 'Hosted group chat' },
  ];
  return (
    <div style={{
      position: 'absolute', top: 22, right: 4, zIndex: 50, width: 240,
      background: theme.bg2, border: `1px solid ${theme.borderStrong}`,
      borderRadius: 5, boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
      padding: 4,
    }}>
      <div style={{ padding: '6px 10px', fontFamily: MONO, fontSize: 9, color: theme.textDim, letterSpacing: 0.5 }}>ADD CONTACT — TYPE</div>
      {types.map(t => (
        <div key={t.type} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
        }}
          onMouseEnter={(e) => e.currentTarget.style.background = theme.bg3}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <div style={{
            width: 22, height: 22, borderRadius: 4, background: theme.bg3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${theme.border}`,
          }}>
            <FCContactGlyph type={t.type} theme={{ ...theme, textDim: theme.text }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: theme.text, fontWeight: 500 }}>{t.label}</div>
            <div style={{ fontSize: 10.5, color: theme.textDim }}>{t.sub}</div>
          </div>
        </div>
      ))}
      <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />
      <div style={{ padding: '6px 10px', fontFamily: MONO, fontSize: 9, color: theme.textDim }}>
        Manual: paste public key · Scan QR · Import link
      </div>
    </div>
  );
}

// ── Connection menu (USB / BLE / TCP) ───────────────────────────────
function FCConnectionMenu({ theme, onClose }) {
  const Row = ({ glyph, label, sub, status, active }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      borderRadius: 4, cursor: 'pointer',
      background: active ? theme.accentBg : 'transparent',
      borderLeft: `2px solid ${active ? theme.accent : 'transparent'}`,
      paddingLeft: 8,
    }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.bg3; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <div style={{
        width: 22, height: 22, borderRadius: 4, background: theme.bg3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: theme.text, border: `1px solid ${theme.border}`,
      }}>{glyph}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: theme.text, fontWeight: 500 }}>{label}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: theme.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
      </div>
      {status && <span style={{
        fontFamily: MONO, fontSize: 9, color: status === 'connected' ? theme.online : theme.textDim,
        padding: '1px 5px', background: theme.bg3, border: `1px solid ${theme.border}`, borderRadius: 2,
      }}>{status}</span>}
    </div>
  );
  return (
    <div style={{
      position: 'absolute', bottom: 36, left: 8, zIndex: 50, width: 268,
      background: theme.bg2, border: `1px solid ${theme.borderStrong}`,
      borderRadius: 5, boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
      padding: 4,
    }}>
      <div style={{ padding: '6px 10px', fontFamily: MONO, fontSize: 9, color: theme.textDim, letterSpacing: 0.5 }}>RADIO CONNECTION</div>
      <Row
        glyph={<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 3v4 M11 3v4 M3 7h10v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z M8 13v3"/></svg>}
        label="USB Serial" sub="/dev/cu.usbmodem01 · 115200" status="connected" active />
      <Row
        glyph={<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3l5 5-5 5V3z M5 6l4 4 M5 10l4-4"/></svg>}
        label="Bluetooth LE" sub="egrme.sh Hand · paired" status="ready" />
      <Row
        glyph={<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6c4-3 8-3 12 0 M4 9c2.5-2 5.5-2 8 0 M6 12c1.5-1 2.5-1 4 0"/><circle cx="8" cy="14" r="0.8" fill="currentColor" stroke="none"/></svg>}
        label="TCP" sub="192.168.1.42:5000" status="" />
      <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />
      <div style={{ display: 'flex', gap: 4, padding: 4 }}>
        <button style={{
          flex: 1, padding: '6px 8px', fontSize: 11, fontFamily: 'inherit',
          background: theme.bg3, color: theme.text, border: `1px solid ${theme.border}`,
          borderRadius: 3, cursor: 'pointer',
        }}>Disconnect</button>
        <button style={{
          flex: 1, padding: '6px 8px', fontSize: 11, fontFamily: 'inherit',
          background: theme.accent, color: '#1c1810', border: `1px solid ${theme.accent}`,
          borderRadius: 3, cursor: 'pointer', fontWeight: 600,
        }}>Add device…</button>
      </div>
    </div>
  );
}

// ── Settings popover ────────────────────────────────────────────────
function FCSettingsPopover({ theme }) {
  const Item = ({ label, hint }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
      borderRadius: 3, cursor: 'pointer', fontSize: 12, color: theme.text,
    }}
      onMouseEnter={(e) => e.currentTarget.style.background = theme.bg3}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ fontFamily: MONO, fontSize: 9, color: theme.textDim }}>{hint}</span>}
    </div>
  );
  return (
    <div style={{
      position: 'absolute', top: 26, right: 8, zIndex: 50, width: 220,
      background: theme.bg2, border: `1px solid ${theme.borderStrong}`,
      borderRadius: 5, boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
      padding: 4,
    }}>
      <div style={{ padding: '6px 10px', fontFamily: MONO, fontSize: 9, color: theme.textDim, letterSpacing: 0.5 }}>SETTINGS</div>
      <Item label="Identity & Keys" hint="⌘1" />
      <Item label="Radio Preset" hint="⌘2" />
      <Item label="Channels & Keys" />
      <Item label="Repeat Mode" hint="off" />
      <Item label="Notifications" />
      <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />
      <Item label="Appearance" hint="auto" />
      <Item label="About MeshCore" />
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────
function FCSidebar({ theme, data, activeKey, onSelect, openPopover, setOpenPopover }) {
  const channels = fcChannels();
  const contacts = fcContacts();
  return (
    <div style={{
      width: 244, background: theme.bg2, borderRight: `1px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Owner header */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 3, background: theme.online, boxShadow: `0 0 8px ${theme.online}` }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.owner.name}</div>
          <button onClick={() => setOpenPopover(openPopover === 'settings' ? null : 'settings')} style={{
            width: 22, height: 22, padding: 0, border: 'none', background: openPopover === 'settings' ? theme.bg3 : 'transparent',
            color: theme.textMuted, cursor: 'pointer', borderRadius: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} title="Settings">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="8" cy="8" r="1.8"/>
              <path d="M8 1.5v2 M8 12.5v2 M14.5 8h-2 M3.5 8h-2 M12.6 3.4l-1.4 1.4 M4.8 11.2l-1.4 1.4 M12.6 12.6l-1.4-1.4 M4.8 4.8l-1.4-1.4"/>
            </svg>
          </button>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: theme.textDim, marginTop: 4 }}>{data.owner.pkShort}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 8, fontFamily: MONO, fontSize: 10 }}>
          <div style={{ color: theme.textDim }}>FREQ <span style={{ color: theme.text }}>910.5</span></div>
          <div style={{ color: theme.textDim }}>SF <span style={{ color: theme.text }}>{data.owner.sf.replace('SF','')}</span></div>
          <div style={{ color: theme.textDim }}>BW <span style={{ color: theme.text }}>62.5</span></div>
          <div style={{ color: theme.textDim }}>TX <span style={{ color: theme.text }}>{data.owner.txPower}dB</span></div>
        </div>
        <div style={{ marginTop: 8, height: 4, background: theme.bg3, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${data.owner.battery}%`, height: '100%', background: theme.accent }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontFamily: MONO, fontSize: 9, color: theme.textDim }}>
          <span>BATT {data.owner.battery}%</span><span>{data.owner.voltage}V</span>
        </div>
        {openPopover === 'settings' && <FCSettingsPopover theme={theme} />}
      </div>

      {/* Pinned: Packet Log */}
      <div style={{ padding: '8px 6px 4px' }}>
        <div
          onClick={() => onSelect('packetlog')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
            borderRadius: 3, cursor: 'pointer',
            background: activeKey === 'packetlog' ? theme.accentBg : 'transparent',
            color: activeKey === 'packetlog' ? theme.text : theme.textMuted,
            fontSize: 12, marginBottom: 1,
            borderLeft: `2px solid ${activeKey === 'packetlog' ? theme.accent : 'transparent'}`,
            paddingLeft: 8,
          }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2 4l3 3-3 3 M14 4l-3 3 3 3 M7 2l-1 12 M11 2l-1 12" />
          </svg>
          <span style={{ flex: 1, fontFamily: MONO, fontSize: 11.5 }}>packet.log</span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: theme.textDim }}>RX/TX</span>
        </div>
      </div>

      {/* Channels */}
      <div style={{ padding: '6px 6px 4px', position: 'relative' }}>
        <FCSectionHeader
          label="CHANNELS" theme={theme}
          onTogglePopover={() => setOpenPopover(openPopover === 'addchan' ? null : 'addchan')}
          popover={openPopover === 'addchan' ? <FCAddChannelPopover theme={theme} /> : null}
        />
        {channels.map(ch => {
          const k = `ch:${ch.name}`;
          const isActive = activeKey === k;
          // Display label: public has no prefix; hashtag shows # via glyph; private shows lock via glyph
          return (
            <div key={ch.name} onClick={() => onSelect(k)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 3,
              background: isActive ? theme.accentBg : 'transparent',
              color: isActive ? theme.text : theme.textMuted,
              fontSize: 12, cursor: 'pointer', marginBottom: 1,
              borderLeft: `2px solid ${isActive ? theme.accent : 'transparent'}`,
              paddingLeft: 8,
            }}>
              <FCChannelGlyph type={ch.type} theme={theme} size={12} />
              <span style={{
                flex: 1,
                fontWeight: ch.type === 'public' ? 600 : 400,
                fontStyle: ch.type === 'private' ? 'normal' : 'normal',
              }}>{ch.name}</span>
              {ch.unread > 0 && (
                <span style={{ fontSize: 9, fontFamily: MONO, color: theme.accent }}>{ch.unread}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Contacts (typed) */}
      <div style={{ padding: '6px 6px 4px', position: 'relative' }}>
        <FCSectionHeader
          label="CONTACTS" theme={theme}
          onTogglePopover={() => setOpenPopover(openPopover === 'addcon' ? null : 'addcon')}
          popover={openPopover === 'addcon' ? <FCAddContactPopover theme={theme} /> : null}
        />
        {contacts.map(c => {
          const k = `c:${c.name}`;
          const isActive = activeKey === k;
          return (
            <div key={c.name} onClick={() => onSelect(k)} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 3,
              background: isActive ? theme.accentBg : 'transparent',
              color: isActive ? theme.text : theme.textMuted,
              fontSize: 12, cursor: 'pointer', marginBottom: 1, opacity: c.stale ? 0.55 : 1,
              borderLeft: `2px solid ${isActive ? theme.accent : 'transparent'}`,
              paddingLeft: 8,
            }}>
              <FCContactGlyph type={c.type} theme={theme} size={12} />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 9, color: theme.textDim }}>{FCFmtTime(c.lastSeen)}</span>
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1 }} />

      {/* Connection status footer (clickable) */}
      <div style={{ position: 'relative', borderTop: `1px solid ${theme.border}` }}>
        <button
          onClick={() => setOpenPopover(openPopover === 'conn' ? null : 'conn')}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', background: openPopover === 'conn' ? theme.bg3 : 'transparent',
            color: theme.textMuted, border: 'none', cursor: 'pointer',
            fontFamily: MONO, fontSize: 10, textAlign: 'left',
          }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: 3,
            background: theme.online, boxShadow: `0 0 6px ${theme.online}`,
          }} />
          <span style={{ flex: 1, lineHeight: 1.4 }}>
            <div style={{ color: theme.text }}>USB · /dev/cu.usbmodem01</div>
            <div style={{ color: theme.textDim }}>tx 124 · rx 891 · q 0</div>
          </span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4l3 3 3-3"/></svg>
        </button>
        {openPopover === 'conn' && <FCConnectionMenu theme={theme} />}
      </div>
    </div>
  );
}

// ── Message info popover (shown when a message is clicked) ──────────
function FCMessageInfoPopover({ theme, msg, onClose }) {
  // Build a synthetic per-hop chain. We use msg.path (array of node names)
  // and assign plausible RSSI/SNR values that improve toward us.
  const hops = msg.path || ['SOCO Meshcore RAK'];
  const rssis = hops.map((_, i) => -95 + i * 6 + (Math.random() * 4 - 2) | 0);
  const snrs = hops.map((_, i) => -3 + i * 2 + Math.random());
  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.35)',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute', right: 16, top: 60, width: 320,
        background: theme.bg2, border: `1px solid ${theme.borderStrong}`,
        borderRadius: 5, boxShadow: '0 16px 36px rgba(0,0,0,0.55)',
        padding: 14, fontFamily: 'inherit',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: theme.textDim, letterSpacing: 0.5 }}>MESSAGE INFO</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            width: 18, height: 18, padding: 0, border: 'none', background: 'transparent',
            color: theme.textDim, cursor: 'pointer',
          }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: theme.text, lineHeight: 1.5, marginBottom: 4 }}>
          <span style={{ color: theme.accent, fontWeight: 600 }}>{msg.from}</span>
          <span style={{ color: theme.textDim, marginLeft: 6 }}>· {msg.time}</span>
        </div>
        <div style={{
          fontSize: 12, color: theme.text, lineHeight: 1.5, marginBottom: 12,
          padding: '8px 10px', background: theme.bg3, borderRadius: 3,
          border: `1px solid ${theme.border}`,
        }}>{msg.body}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: theme.textDim }}>HOPS</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: theme.text }}>{hops.length}</div>
          </div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: theme.textDim }}>REPEATS HEARD</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: theme.text }}>{(msg.repeats != null ? msg.repeats : Math.max(1, hops.length))}</div>
          </div>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9, color: theme.textDim }}>STATE</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: msg.state === 'acked' ? theme.online : theme.warn }}>
              {msg.state || 'received'}
            </div>
          </div>
        </div>

        <div style={{ fontFamily: MONO, fontSize: 9, color: theme.textDim, letterSpacing: 0.5, marginBottom: 6 }}>PATH</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {hops.map((h, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '14px 1fr auto', gap: 8,
              padding: '5px 8px', background: theme.bg3, borderRadius: 3,
              border: `1px solid ${theme.border}`, alignItems: 'center',
            }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: theme.textDim }}>{i + 1}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: theme.textMuted }}>
                {rssis[i]}dBm · {snrs[i].toFixed(1)}snr
              </span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 9.5, color: theme.textDim, lineHeight: 1.5 }}>
          msg id <span style={{ color: theme.text }}>0x{((msg.id || 'm').charCodeAt(1) * 1721 % 0xffff).toString(16).padStart(4, '0')}</span>
          {' · '}sig <span style={{ color: theme.text }}>verified</span>
          {' · '}flood <span style={{ color: theme.text }}>no</span>
        </div>
      </div>
    </div>
  );
}

// ── Message row ─────────────────────────────────────────────────────
function FCMessage({ m, theme, onSelect, selected }) {
  const isSelf = m.role === 'self';
  return (
    <div onClick={() => onSelect(m)} style={{
      display: 'grid', gridTemplateColumns: '54px 1fr', gap: 12,
      padding: '6px 20px 6px 12px',
      borderLeft: `2px solid ${selected ? theme.accent : (isSelf ? theme.accent : 'transparent')}`,
      background: selected ? theme.bg3 : 'transparent',
      cursor: 'pointer',
    }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = theme.bg2; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = 'transparent'; }}>
      <div style={{ fontFamily: MONO, fontSize: 10, color: theme.textDim, paddingTop: 2 }}>{m.time}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 12, fontWeight: 600,
            color: isSelf ? theme.accent : theme.text,
          }}>{m.from}</span>
          {m.state === 'sending' && <span style={{ fontFamily: MONO, fontSize: 9, color: theme.warn }}>tx…</span>}
          {m.state === 'acked' && <span style={{ fontFamily: MONO, fontSize: 9, color: theme.online }}>ack</span>}
          {m.state === 'relayed' && <span style={{ fontFamily: MONO, fontSize: 9, color: theme.warn }}>relay</span>}
        </div>
        <div style={{ fontSize: 12.5, color: theme.text, lineHeight: 1.5 }}>{m.body}</div>
      </div>
    </div>
  );
}

// ── Channel header ──────────────────────────────────────────────────
function FCChannelHeader({ theme, channelKey }) {
  // Resolve label by key
  let glyph = null, label = '', sub = '';
  if (channelKey === 'packetlog') {
    glyph = (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={theme.accent} strokeWidth="1.5">
        <path d="M2 4l3 3-3 3 M14 4l-3 3 3 3 M7 2l-1 12 M11 2l-1 12" />
      </svg>
    );
    label = 'packet.log';
    sub = 'all rx/tx · 910.525 MHz';
  } else if (channelKey && channelKey.startsWith('ch:')) {
    const name = channelKey.slice(3);
    const ch = fcChannels().find(x => x.name === name) || { type: 'hashtag', name };
    glyph = <FCChannelGlyph type={ch.type} theme={{ ...theme, textDim: theme.accent }} size={13} />;
    label = ch.name;
    sub = ch.type === 'public' ? 'public · open key'
        : ch.type === 'private' ? 'private · shared key'
        : `hashtag · open · key 2fa78a5a`;
  } else if (channelKey && channelKey.startsWith('c:')) {
    const name = channelKey.slice(2);
    const c = fcContacts().find(x => x.name === name) || { type: 'chat', name };
    glyph = <FCContactGlyph type={c.type} theme={{ ...theme, textDim: theme.accent }} size={13} />;
    label = c.name;
    sub = c.type === 'chat' ? 'direct · end-to-end'
        : c.type === 'repeater' ? 'repeater · advert visible'
        : c.type === 'sensor' ? 'sensor · telemetry'
        : 'room server · group';
  }
  return (
    <div style={{
      padding: '8px 20px', borderBottom: `1px solid ${theme.border}`,
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
    }}>
      {glyph}
      <span style={{ fontFamily: 'inherit', fontSize: 13, fontWeight: 600, color: theme.text }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 10, color: theme.textDim }}>· {sub}</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontFamily: MONO, fontSize: 10, color: theme.textDim }}>⌘K</span>
    </div>
  );
}

// ── Packet Log view (special channel) ───────────────────────────────
function FCPacketLog({ theme }) {
  // Synthetic feed. Mix of inbound/outbound/system, every entry monospace.
  const lines = [
    { t: '17:42:01.122', dir: 'rx', kind: 'ADV',  src: '<87ace08a>', meta: 'rssi=-68 snr=8.2', body: 'advert · SOCO Meshcore RAK' },
    { t: '17:42:04.018', dir: 'rx', kind: 'MSG',  src: 'FLO1',       meta: '9h · 1b · ack',  body: 'Cool, my new Cedar Park repeater worked' },
    { t: '17:42:09.401', dir: 'sys', kind: 'RTE', src: 'router',     meta: '',                body: 'route updated: Cedar Park via SOCO Meshcore RAK' },
    { t: '17:42:12.220', dir: 'tx', kind: 'FWD',  src: 'self',       meta: '→ 3 nbrs',        body: 'forwarded msg id=4f2a' },
    { t: '17:42:18.701', dir: 'rx', kind: 'ADV',  src: '<698fc698>', meta: 'rssi=-82 snr=5.4', body: 'advert · SOCO RAK 1W' },
    { t: '17:42:23.000', dir: 'cmd', kind: 'CMD', src: 'self',       meta: '',                body: 'get telemetry' },
    { t: '17:42:23.012', dir: 'rx', kind: 'TLM',  src: 'self',       meta: '',                body: '{ battery: 87%, airtime: 2.3%, uptime: 12d 4h }' },
    { t: '17:42:30.812', dir: 'rx', kind: 'MSG',  src: 'Ave Maritza-M', meta: '2h · 1b',      body: '#meetup · who is bringing antennas' },
    { t: '17:42:34.114', dir: 'sys', kind: 'WRN', src: 'router',     meta: '',                body: 'neighbor SOCO RAK 1W airtime warning: 4.7%' },
    { t: '17:42:40.557', dir: 'tx', kind: 'MSG',  src: 'self',       meta: '#meshcore',       body: 'rxing you 5×9 down here' },
    { t: '17:42:41.220', dir: 'rx', kind: 'ACK',  src: 'SOCO Meshcore RAK', meta: 'msg=4f2a',  body: 'heard 1 repeat' },
    { t: '17:42:44.002', dir: 'rx', kind: 'MSG',  src: 'Picassoman-M', meta: '3h · 2b',       body: '@Ave Maritza-M nothing in dripping' },
    { t: '17:42:50.118', dir: 'rx', kind: 'TLM',  src: 'WX-Roof',    meta: '1h',              body: '{ tempC: 18.3, rh: 62, wind: 4.1 }' },
    { t: '17:42:55.404', dir: 'rx', kind: 'ADV',  src: '<4471a2c9>', meta: 'rssi=-94 snr=2.1', body: 'advert · Bender DT' },
  ];
  const dirColor = (d) => d === 'rx' ? theme.online : d === 'tx' ? theme.accent : d === 'cmd' ? theme.text : theme.textDim;
  const dirLabel = (d) => d === 'rx' ? 'RX' : d === 'tx' ? 'TX' : d === 'cmd' ? '››' : 'SY';
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', fontFamily: MONO, fontSize: 11.5 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '94px 28px 38px 130px 1fr 130px',
        gap: 8, padding: '4px 20px',
        fontSize: 9, color: theme.textDim, letterSpacing: 0.5,
        borderBottom: `1px solid ${theme.border}`,
      }}>
        <span>TIMESTAMP</span><span>DIR</span><span>KIND</span><span>SOURCE</span><span>PAYLOAD</span><span style={{ textAlign: 'right' }}>META</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '94px 28px 38px 130px 1fr 130px',
          gap: 8, padding: '3px 20px',
          color: theme.textMuted,
        }}>
          <span style={{ color: theme.textDim }}>{l.t}</span>
          <span style={{ color: dirColor(l.dir), fontWeight: 600 }}>{dirLabel(l.dir)}</span>
          <span style={{ color: theme.text }}>{l.kind}</span>
          <span style={{ color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.src}</span>
          <span style={{ color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.body}</span>
          <span style={{ color: theme.textDim, textAlign: 'right' }}>{l.meta}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main pane ───────────────────────────────────────────────────────
function FCMain({ theme, data, channelKey, selectedMsg, onSelectMsg }) {
  const isPacket = channelKey === 'packetlog';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: theme.bg, position: 'relative' }}>
      <FCChannelHeader theme={theme} channelKey={channelKey} />

      {isPacket ? (
        <FCPacketLog theme={theme} />
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {data.messages.map(m => (
            <FCMessage key={m.id} m={m} theme={theme}
              selected={selectedMsg && selectedMsg.id === m.id}
              onSelect={onSelectMsg} />
          ))}
        </div>
      )}

      {!isPacket && (
        <div style={{ padding: '10px 20px 14px', borderTop: `1px solid ${theme.border}`, flexShrink: 0 }}>
          <div style={{
            background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 3,
            padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: MONO, fontSize: 12,
          }}>
            <span style={{ color: theme.accent }}>›</span>
            <span style={{ flex: 1, color: theme.textDim }}>tx to {channelKey && channelKey.startsWith('ch:') ? channelKey.slice(3) : 'channel'}_</span>
            <span style={{ fontSize: 10, color: theme.textDim }}>140/200 · ETA 1.4s · 3 hops</span>
          </div>
        </div>
      )}

      {selectedMsg && !isPacket && (
        <FCMessageInfoPopover theme={theme} msg={selectedMsg} onClose={() => onSelectMsg(null)} />
      )}
    </div>
  );
}

function FieldConsole({ mode = 'dark', data }) {
  const theme = FC_THEMES[mode];
  const [activeKey, setActiveKey] = React.useState('ch:meshcore');
  const [openPopover, setOpenPopover] = React.useState(null);
  const [selectedMsg, setSelectedMsg] = React.useState(null);

  // For demo continuity, the dark variant pre-opens the message info popover
  // on the "Cool, my new Cedar Park..." message so the feature is visible.
  React.useEffect(() => {
    if (mode === 'dark' && data && data.messages) {
      const m = data.messages.find(x => /Cedar Park/.test(x.body || ''));
      if (m) setSelectedMsg(m);
    }
  }, []);

  const select = (k) => { setActiveKey(k); setOpenPopover(null); setSelectedMsg(null); };

  return (
    <div onClick={() => setOpenPopover(null)} style={{
      display: 'flex', height: '100%', width: '100%',
      background: theme.bg, color: theme.text,
      fontFamily: '"Inter", -apple-system, "Segoe UI", sans-serif',
      fontSize: 13, overflow: 'hidden', position: 'relative',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexShrink: 0 }}>
        <FCSidebar theme={theme} data={data} activeKey={activeKey} onSelect={select}
          openPopover={openPopover} setOpenPopover={setOpenPopover} />
      </div>
      <FCMain theme={theme} data={data} channelKey={activeKey}
        selectedMsg={selectedMsg} onSelectMsg={setSelectedMsg} />
    </div>
  );
}

window.FieldConsole = FieldConsole;
