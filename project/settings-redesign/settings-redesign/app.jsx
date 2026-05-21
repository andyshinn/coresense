// Mounts the SettingsPanel mock inside DesignCanvas. Application + Radio
// tabs, each in light + dark, plus a Radio tab no-connected pair.

const ARTBOARD_W = 820;
const ARTBOARD_H = 900;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "amber",
  "showDisconnected": true
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const accent = tweaks.accent;
  const light = window.MC_PALETTE.make('light', accent);
  const dark  = window.MC_PALETTE.make('dark',  accent);
  const themes = { light, dark };

  const card = (tab, connected, mode) => {
    const tag = `${tab}-${mode}${connected ? '' : '-off'}`;
    const label = `${mode === 'light' ? 'Light' : 'Dark'}${connected ? '' : ' · disconnected'}`;
    return (
      <DCArtboard key={tag} id={tag} label={label} width={ARTBOARD_W} height={ARTBOARD_H}>
        <SettingsPanel theme={themes[mode]} tab={tab} connected={connected}/>
      </DCArtboard>
    );
  };

  return (
    <React.Fragment>
      <DesignCanvas>
        <DCSection
          id="app-settings"
          title="Application Settings"
          subtitle="Local preferences · auto-saved. Pill tabs, sticky right rail, per-section Save.">
          {card('app', true, 'light')}
          {card('app', true, 'dark')}
        </DCSection>

        <DCSection
          id="radio-settings"
          title="Radio Settings"
          subtitle="Stored on the radio. Same layout, per-section Save buttons commit to the device.">
          {card('radio', true, 'light')}
          {card('radio', true, 'dark')}
        </DCSection>

        {tweaks.showDisconnected && (
          <DCSection
            id="radio-disconnected"
            title="Radio Settings · No radio connected"
            subtitle="Controls remain visible but disabled; a banner offers a Connect CTA.">
            {card('radio', false, 'light')}
            {card('radio', false, 'dark')}
          </DCSection>
        )}
      </DesignCanvas>

      <TweaksPanel title="Tweaks">
        <TweakSection title="Accent">
          <AccentSwatchPicker
            value={accent}
            options={Object.entries(window.MC_PALETTE.accentSwatches).map(([key, s]) => ({
              value: key, color: s.light, name: s.name,
            }))}
            onChange={(v) => setTweak('accent', v)}
          />
          <div style={{ fontSize: 11, color: '#a39884', lineHeight: 1.45, marginTop: 4 }}>
            Light-mode hue shown. Dark mode shifts one stop brighter automatically.
          </div>
        </TweakSection>
        <TweakSection title="Sections">
          <TweakToggle
            label="Show no-radio state"
            value={tweaks.showDisconnected}
            onChange={(v) => setTweak('showDisconnected', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </React.Fragment>
  );
}

// Named accent swatches. tweaks-panel.jsx's TweakColor takes a flat list of
// hex strings — we want named tokens so we render our own.
function AccentSwatchPicker({ value, options, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        fontSize: 11, fontWeight: 500,
        color: 'var(--tweaks-label, #a39884)',
        textTransform: 'uppercase', letterSpacing: 0.4,
      }}>Accent swatch</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {options.map(opt => {
          const on = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              title={opt.name}
              style={{
                width: 32, height: 32, padding: 0,
                borderRadius: 6,
                background: opt.color,
                border: on ? '2px solid #fafafa' : '2px solid transparent',
                cursor: 'pointer',
                boxShadow: on ? '0 0 0 1px rgba(0,0,0,0.4)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
