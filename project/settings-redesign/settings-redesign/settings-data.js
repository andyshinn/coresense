// Settings spec for the mock — declarative rows grouped into sections, per
// tab. Mirrors AppSettings.tsx and the per-tab files referenced from
// SettingsPanel.tsx. Each row has a control descriptor that the renderer
// resolves to <Toggle>/<Select>/<NumberInput>/<TextInput>.
//
// `dirty` on a section is a render-time hint so the mock can show what
// the per-section Save button looks like in its enabled state.

window.MC_SETTINGS = (() => {

  // ── App tab ────────────────────────────────────────────────────────
  const app = [
    {
      id: 'appearance',
      title: 'Appearance',
      icon: 'sun',
      description: 'Visual preferences for the app window.',
      dirty: false,
      rows: [
        { label: 'Theme', desc: 'Auto follows your OS setting · ⌘T cycles.',
          ctrl: { kind: 'select', value: 'auto', width: 200, options: [
            { value: 'auto', label: 'Auto (system)' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}},
        { label: 'Message density', desc: 'Rich shows sender + RSSI / SNR / hops. Compact is a single line.',
          ctrl: { kind: 'select', value: 'rich', width: 220, options: [
            { value: 'rich', label: 'Rich (sender + meta)' },
            { value: 'compact', label: 'Compact (one line)' },
          ]}},
        { label: 'Contact list grouping', desc: 'Nested keeps one Contacts section; top-level promotes each kind.',
          ctrl: { kind: 'select', value: 'nested', width: 220, options: [
            { value: 'nested', label: 'Nested (under Contacts)' },
            { value: 'top-level', label: 'Top-level sections' },
          ]}},
      ],
    },
    {
      id: 'composer',
      title: 'Composer',
      icon: 'send',
      rows: [
        { label: 'Return sends, Shift-Return inserts newline',
          desc: 'Off makes Return insert a newline and ⌘-Return send.',
          ctrl: { kind: 'toggle', value: true }},
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications',
      icon: 'bell',
      description: 'Fired only when the app is unfocused or you’re viewing a different conversation.',
      dirty: true,
      rows: [
        { label: 'Direct messages',           ctrl: { kind: 'toggle', value: true  }},
        { label: 'Channel mentions',          desc: '@name in a channel.',
          ctrl: { kind: 'toggle', value: true  }},
        { label: 'All channel messages',      desc: 'Noisy on busy channels — off by default.',
          ctrl: { kind: 'toggle', value: false }},
        { label: 'Repeater alerts',           ctrl: { kind: 'toggle', value: true  }},
        { label: 'Sensor alerts',             ctrl: { kind: 'toggle', value: false }},
        { label: 'Play sound',                ctrl: { kind: 'toggle', value: true  }},
        { label: 'Suppress while focused',    desc: 'Don’t notify if the app window is in the foreground.',
          ctrl: { kind: 'toggle', value: true  }},
        { label: 'Dock badge (macOS)',        desc: 'Unread count on the app icon.',
          ctrl: { kind: 'toggle', value: true  }},
      ],
    },
    {
      id: 'toasts',
      title: 'Toasts',
      icon: 'bell',
      description: 'In-app status messages shown in the bottom-right.',
      rows: [
        { label: 'Enabled',          ctrl: { kind: 'toggle', value: true }},
        { label: 'Duration',         desc: 'How long each toast stays visible before auto-dismissing.',
          ctrl: { kind: 'number', value: 4, suffix: 's', width: 80 }},
      ],
    },
    {
      id: 'proxy',
      title: 'TCP / WS Proxy',
      icon: 'wifi',
      description: 'Lets the official MeshCore mobile app (or another desktop client) share this radio over LAN.',
      footnote: 'Bind / port / mDNS changes take effect on next launch.',
      rows: [
        { label: 'Enabled',          ctrl: { kind: 'toggle', value: true }},
        { label: 'Bind to all interfaces (0.0.0.0)',
          desc: 'Off binds to 127.0.0.1 only; on allows LAN clients to connect.',
          warning: 'Anyone on your network can connect to this radio without auth.',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'TCP port',         desc: 'Bridge serves both raw TCP and WS on this port.',
          ctrl: { kind: 'number', value: 5000, width: 96 }},
        { label: 'Advertise via mDNS', desc: 'So clients on the LAN can find this radio by name.',
          ctrl: { kind: 'toggle', value: true }},
      ],
    },
    {
      id: 'behavior',
      title: 'Behavior',
      icon: 'sliders',
      rows: [
        { label: 'Pin unread to top',
          desc: 'Sort unread channels and contacts above pinned items.',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Auto-reconnect on launch',
          desc: 'Reconnect to the last device when the app starts.',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Hide channels not on radio',
          desc: 'Off shows missing channels grayed-out; on hides them entirely.',
          ctrl: { kind: 'toggle', value: false }},
        { label: 'Default search sort',
          ctrl: { kind: 'select', value: 'recency', width: 220, options: [
            { value: 'recency', label: 'Recency (newest first)' },
            { value: 'relevance', label: 'Relevance (BM25)' },
          ]}},
        { label: 'Show sidebar search',
          desc: 'Quick-filter field above Conversations. ⌘F focuses it.',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Collapse long lists',
          desc: 'Cap each LeftNav branch and add a Show-more button.',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Items before Show more',
          ctrl: { kind: 'number', value: 12, width: 80 }},
      ],
    },
    {
      id: 'map',
      title: 'Map Tiles',
      icon: 'map',
      description: 'API keys for map tile providers used by the Map and Position panels.',
      rows: [
        { label: 'Provider',
          ctrl: { kind: 'select', value: 'maptiler', width: 220, options: [
            { value: 'maptiler', label: 'MapTiler' },
            { value: 'mapbox',   label: 'Mapbox' },
            { value: 'osm',      label: 'OpenStreetMap (no key)' },
          ]}},
        { label: 'API key',
          desc: 'Stored locally · never sent to the radio.',
          ctrl: { kind: 'text', mono: true, value: '••••••••••••••8a3f', width: 260 }},
      ],
    },
  ];

  // ── Radio tab ──────────────────────────────────────────────────────
  const radio = [
    {
      id: 'identity',
      title: 'Public Info',
      icon: 'user',
      description: 'Name and avatar broadcast in adverts. Stored on the radio.',
      dirty: true,
      rows: [
        { label: 'Display name',
          ctrl: { kind: 'text', value: 'egrme.sh Hand', width: 260 }},
        { label: 'Public key',
          desc: 'Derived from your identity key — read-only.',
          ctrl: { kind: 'text', mono: true, value: '1a3d3c6a…590dd5d5', width: 260 }},
        { label: 'Role',
          ctrl: { kind: 'select', value: 'companion', width: 200, options: [
            { value: 'companion', label: 'Companion' },
            { value: 'repeater',  label: 'Repeater' },
            { value: 'room',      label: 'Room server' },
          ]}},
      ],
    },
    {
      id: 'radio',
      title: 'Radio',
      icon: 'radio',
      description: 'LoRa modulation parameters. Must match peers on the same mesh.',
      footnote: 'Changing modulation re-keys the radio; reachable peers may need to refresh.',
      rows: [
        { label: 'Frequency',
          ctrl: { kind: 'number', value: 910.525, suffix: 'MHz', width: 120 }},
        { label: 'Bandwidth',
          ctrl: { kind: 'select', value: '62.5', width: 160, options: [
            { value: '62.5',  label: '62.5 kHz' },
            { value: '125',   label: '125 kHz'  },
            { value: '250',   label: '250 kHz'  },
            { value: '500',   label: '500 kHz'  },
          ]}},
        { label: 'Spreading factor',
          ctrl: { kind: 'select', value: 'sf7', width: 160, options: [
            { value: 'sf7',  label: 'SF7'  },
            { value: 'sf8',  label: 'SF8'  },
            { value: 'sf9',  label: 'SF9'  },
            { value: 'sf10', label: 'SF10' },
          ]}},
        { label: 'Coding rate',
          ctrl: { kind: 'select', value: '4/5', width: 160, options: [
            { value: '4/5', label: '4/5' },
            { value: '4/6', label: '4/6' },
            { value: '4/7', label: '4/7' },
            { value: '4/8', label: '4/8' },
          ]}},
        { label: 'TX power',
          ctrl: { kind: 'number', value: 20, suffix: 'dBm', width: 110 }},
      ],
    },
    {
      id: 'identity-key',
      title: 'Identity Key',
      icon: 'key',
      description: 'The Ed25519 keypair used to sign your adverts. Back it up before re-flashing.',
      rows: [
        { label: 'Public key',
          ctrl: { kind: 'text', mono: true, value: '1a3d3c6a4f…590dd5d5', width: 260 }},
        { label: 'Fingerprint',
          ctrl: { kind: 'text', mono: true, value: '1a3d 3c6a 4f 19 7e b3', width: 260 }},
        { label: 'Export to file',
          ctrl: { kind: 'button', label: 'Export…' }},
        { label: 'Rotate key',
          desc: 'Destroys current identity. All contacts must re-add you.',
          ctrl: { kind: 'button', label: 'Rotate…', danger: true }},
      ],
    },
    {
      id: 'bluetooth',
      title: 'Bluetooth',
      icon: 'bt',
      rows: [
        { label: 'BLE enabled',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Pairing PIN',
          desc: 'Required when a new client connects over BLE.',
          ctrl: { kind: 'number', value: 123456, width: 110 }},
        { label: 'Advertised name',
          ctrl: { kind: 'text', value: 'MeshCore-Hand-3C6A', width: 260 }},
      ],
    },
    {
      id: 'contacts',
      title: 'Contacts · Auto-add',
      icon: 'contact',
      rows: [
        { label: 'Auto-add repeaters',
          desc: 'Add any repeater seen advertising within a few hops.',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Auto-add companions',
          ctrl: { kind: 'toggle', value: false }},
        { label: 'Minimum SNR',
          ctrl: { kind: 'number', value: 2.0, suffix: 'dB', width: 110 }},
      ],
    },
    {
      id: 'message',
      title: 'Messages',
      icon: 'send',
      rows: [
        { label: 'Store-and-forward',
          desc: 'Cache messages for offline peers and retry on reconnect.',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Max retries',
          ctrl: { kind: 'number', value: 3, width: 80 }},
        { label: 'ACK timeout',
          ctrl: { kind: 'number', value: 8, suffix: 's', width: 96 }},
      ],
    },
    {
      id: 'position',
      title: 'Position',
      icon: 'map',
      description: 'Geolocation broadcast in adverts.',
      rows: [
        { label: 'Share position',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Latitude',
          ctrl: { kind: 'text', mono: true, value: '30.211336', width: 140 }},
        { label: 'Longitude',
          ctrl: { kind: 'text', mono: true, value: '-97.761527', width: 140 }},
        { label: 'Round to 100m',
          desc: 'Privacy: snap coordinates to a 0.001° grid.',
          ctrl: { kind: 'toggle', value: false }},
      ],
    },
    {
      id: 'telemetry',
      title: 'Telemetry',
      icon: 'sliders',
      rows: [
        { label: 'Broadcast battery / voltage',
          ctrl: { kind: 'toggle', value: true }},
        { label: 'Broadcast uptime',
          ctrl: { kind: 'toggle', value: false }},
        { label: 'Heartbeat interval',
          ctrl: { kind: 'number', value: 600, suffix: 's', width: 110 }},
      ],
    },
    {
      id: 'device-info',
      title: 'Device Info',
      icon: 'info',
      description: 'Read-only — what this firmware reports about itself.',
      rows: [
        { label: 'Hardware',
          ctrl: { kind: 'text', mono: true, value: 'RAK4631 · nRF52840', width: 260, disabled: true }},
        { label: 'Firmware',
          ctrl: { kind: 'text', mono: true, value: 'meshcore-1.7.3+482', width: 260, disabled: true }},
        { label: 'Build date',
          ctrl: { kind: 'text', mono: true, value: '2026-05-04 18:22 UTC', width: 260, disabled: true }},
      ],
    },
  ];

  return { app, radio };
})();
