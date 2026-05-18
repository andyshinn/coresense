const { useState, useEffect } = React;
const data = window.MESHCORE_DATA;

function MacFrame({ title, titlebarBg, titlebarFg, children }) {
  return (
    <div
      className="mac-window"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: titlebarBg,
      }}
    >
      <div
        className="mac-titlebar"
        style={{
          background: titlebarBg,
          color: titlebarFg,
          borderBottom: `1px solid ${titlebarFg}22`,
        }}
      >
        <div className="lights">
          <div className="light l1"></div>
          <div className="light l2"></div>
          <div className="light l3"></div>
        </div>
        <div style={{ flex: 1, textAlign: 'center', opacity: 0.7 }}>{title}</div>
        <div style={{ width: 52 }}></div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  );
}

// ⌘K palette overlay
function CommandPalette({ theme, onClose, accent = '#22d3ee', dark = true }) {
  const items = [
    { kind: 'channel', label: '#meetup', hint: 'Switch to channel' },
    { kind: 'channel', label: '#testing', hint: 'Switch to channel' },
    { kind: 'peer', label: 'Mt. Bonnell 🗻', hint: 'Open repeater details' },
    { kind: 'peer', label: 'Finkle🦖', hint: 'Send direct message' },
    { kind: 'cmd', label: 'Send advert', hint: 'Broadcast presence' },
    { kind: 'cmd', label: 'Connect radio…', hint: 'USB / BLE / TCP' },
    { kind: 'cmd', label: 'Toggle theme', hint: 'Light / Dark / Auto' },
  ];
  const bg = dark ? '#0c0c0c' : '#ffffff';
  const fg = dark ? '#fafafa' : '#0a0a0a';
  const muted = dark ? '#737373' : '#737373';
  const border = dark ? '#262626' : '#e5e5e5';
  const hover = dark ? '#1a1a1a' : '#f5f5f5';
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
        zIndex: 50,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          background: bg,
          borderRadius: 10,
          border: `1px solid ${border}`,
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 14px',
            borderBottom: `1px solid ${border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ color: accent, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
            ⌘K
          </span>
          <input
            autoFocus
            placeholder="Search channels, peers, commands…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: fg,
              fontSize: 14,
              fontFamily: 'inherit',
            }}
          />
          <span style={{ fontSize: 10, color: muted, fontFamily: 'ui-monospace, monospace' }}>
            esc
          </span>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: '4px 0' }}>
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                background: i === 0 ? hover : 'transparent',
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontFamily: 'ui-monospace, monospace',
                  color: muted,
                  padding: '2px 5px',
                  border: `1px solid ${border}`,
                  borderRadius: 3,
                  textTransform: 'uppercase',
                }}
              >
                {item.kind}
              </span>
              <span style={{ color: fg, fontSize: 13, flex: 1 }}>{item.label}</span>
              <span style={{ color: muted, fontSize: 11 }}>{item.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Hover popover demo on Quiet Operator
function PeerPopover({ theme, peer, anchor, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: anchor.y,
          left: anchor.x,
          width: 280,
          background: '#0c0c0c',
          border: '1px solid #262626',
          borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          padding: 14,
          color: '#fafafa',
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: 3, background: '#34d399' }} />
          <div style={{ fontWeight: 600, flex: 1 }}>{peer.name}</div>
          <div style={{ fontSize: 10, color: '#737373', fontFamily: 'ui-monospace, monospace' }}>
            repeater
          </div>
        </div>
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 10,
            color: '#a3a3a3',
            marginBottom: 10,
            wordBreak: 'break-all',
          }}
        >
          {peer.pk}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            fontSize: 11,
            marginBottom: 10,
          }}
        >
          <div>
            <div style={{ color: '#737373' }}>RSSI</div>
            <div style={{ fontFamily: 'ui-monospace, monospace' }}>{peer.rssi} dBm</div>
          </div>
          <div>
            <div style={{ color: '#737373' }}>SNR</div>
            <div style={{ fontFamily: 'ui-monospace, monospace' }}>{peer.snr} dB</div>
          </div>
          <div>
            <div style={{ color: '#737373' }}>Hops</div>
            <div style={{ fontFamily: 'ui-monospace, monospace' }}>{peer.hops}</div>
          </div>
          <div>
            <div style={{ color: '#737373' }}>Last heard</div>
            <div style={{ fontFamily: 'ui-monospace, monospace' }}>20m ago</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#a3a3a3', marginBottom: 8 }}>
          <div>📍 30.32077, -97.77335</div>
          <div>🔋 Battery 78% · Solar OK</div>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button
            style={{
              flex: 1,
              padding: '5px 10px',
              background: '#22d3ee',
              color: '#0a0a0a',
              border: 'none',
              borderRadius: 5,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Trace route
          </button>
          <button
            style={{
              flex: 1,
              padding: '5px 10px',
              background: 'transparent',
              color: '#fafafa',
              border: '1px solid #262626',
              borderRadius: 5,
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Pin to map
          </button>
        </div>
      </div>
    </div>
  );
}

function ArtboardWithChrome({
  title,
  titlebarBg,
  titlebarFg,
  children,
  showPalette,
  paletteAccent,
  paletteDark,
  onClosePalette,
  showPopover,
  popoverPeer,
}) {
  return (
    <MacFrame title={title} titlebarBg={titlebarBg} titlebarFg={titlebarFg}>
      {children}
      {showPalette && (
        <CommandPalette accent={paletteAccent} dark={paletteDark} onClose={onClosePalette} />
      )}
      {showPopover && popoverPeer && (
        <PeerPopover peer={popoverPeer} anchor={{ x: 50, y: 200 }} onClose={() => {}} />
      )}
    </MacFrame>
  );
}

function App() {
  const [paletteOpen, setPaletteOpen] = useState('fc-dark');

  // Allow clicking artboard to toggle its palette
  const togglePalette = (id) => () => setPaletteOpen((p) => (p === id ? null : id));

  return (
    <DesignCanvas>
      <DCSection
        id="fc"
        title="Field Console"
        subtitle="amber 'signal' accent · RSSI/hop chips · mono-forward"
      >
        <DCArtboard id="fc-dark" label="Dark · ⌘K open" width={1280} height={780}>
          <ArtboardWithChrome
            title="MeshCore — #meshcore"
            titlebarBg="#13110b"
            titlebarFg="#f5f1e6"
            showPalette={paletteOpen === 'fc-dark'}
            paletteAccent="#f59e0b"
            paletteDark={true}
            onClosePalette={togglePalette('fc-dark')}
          >
            <div onClick={togglePalette('fc-dark')} style={{ width: '100%', height: '100%' }}>
              <FieldConsole mode="dark" data={data} />
            </div>
          </ArtboardWithChrome>
        </DCArtboard>
        <DCArtboard id="fc-light" label="Light" width={1280} height={780}>
          <ArtboardWithChrome
            title="MeshCore — #meshcore"
            titlebarBg="#f5f1e6"
            titlebarFg="#1c1810"
          >
            <FieldConsole mode="light" data={data} />
          </ArtboardWithChrome>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
