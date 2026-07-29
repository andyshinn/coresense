// cli-data.js — MeshCore repeater CLI catalog, distilled from docs.meshcore.io/cli_commands/
// Each entry carries the metadata that actually matters when the command travels
// over LoRa: whether a reply is expected, whether it is serial-only (unreachable
// over the air), whether it reboots the node, whether it is destructive, the
// firmware floor, and how many frames the round trip costs.
window.CLI_DATA = (() => {
  // Live-ish node state the mock `get`/`set` pair reads and mutates.
  const node = {
    name: 'egrme.sh RAK3401', role: 'Repeater', ver: 'v1.14.3', board: 'RAK4631',
    hops: 3, sf: 11,
    radio: '869.525,250,11,5', freq: '869.525', tx: '22', 'radio.rxgain': 'on',
    lat: '30.21143', lon: '-97.76217', 'owner.info': '', 'guest.password': '',
    'adc.multiplier': '1.87', 'public.key': '42da74c1908fe3bb1a0c7d4419e7d8e5',
    repeat: 'on', 'path.hash.mode': '1', 'loop.detect': 'off',
    txdelay: '0.5', 'direct.txdelay': '0.2', rxdelay: '0.0',
    dutycycle: '50', af: '1.0', 'int.thresh': '0.0', 'agc.reset.interval': '0',
    'multi.acks': '0', 'flood.advert.interval': '12', 'advert.interval': '0',
    'flood.max': '64', 'flood.max.unscoped': '64', 'flood.max.advert': '8',
    'allow.read.only': 'off', powersaving: 'off', gps: 'off',
  };

  // C(name, group, desc, opts)
  //   serial   — serial-only, cannot be run over the air
  //   noReply  — the node never answers
  //   reboot   — takes effect only after a reboot
  //   danger   — destructive, needs confirmation
  //   admin    — requires an admin session
  //   fw       — minimum firmware
  //   rx       — expected reply frames (airtime estimate)
  //   args     — [{ name, hint, enum:[...], enumDesc:{}, range:[lo,hi] }]
  //   spec     — literal argument shape shown as ghost text
  //   presets  — quick-fill values
  //   key      — node-state key for get/set pairs
  const C = (name, group, desc, o) => ({ name, group, desc, rx: 1, ...(o || {}) });
  const onOff = (k) => ([{ name: 'state', enum: ['on', 'off'], key: k }]);

  const commands = [
    // ── Operational ────────────────────────────────────────────────────
    C('reboot', 'Operational', 'Restart the node', { noReply: true, admin: true, rx: 0 }),
    C('poweroff', 'Operational', 'Power the node down', { noReply: true, admin: true, danger: true, rx: 0, alias: 'shutdown', note: 'The node goes dark and cannot be woken over the air — someone has to power-cycle it in person.' }),
    C('clkreboot', 'Operational', 'Reset the clock and reboot', { noReply: true, admin: true, rx: 0 }),
    C('clock', 'Operational', 'Display current time in UTC'),
    C('clock sync', 'Operational', 'Sync the clock with this device'),
    C('time', 'Operational', 'Set the time to a specific timestamp', { spec: '<epoch_seconds>', args: [{ name: 'epoch_seconds', hint: 'Unix epoch time' }] }),
    C('advert', 'Operational', 'Send a flood advert'),
    C('advert.zerohop', 'Operational', 'Send a zero-hop advert'),
    C('start ota', 'Operational', 'Begin an over-the-air firmware update', { admin: true }),
    C('erase', 'Operational', 'Factory reset — wipes all settings and keys', { serial: true, danger: true, admin: true, noReply: true, rx: 0, note: 'Wipes settings, ACL and the node identity. Serial console only — it is never accepted over the air.' }),

    // ── Neighbors ──────────────────────────────────────────────────────
    C('neighbors', 'Neighbors', 'List nearby neighbors', { rx: 3, note: 'Limited to the 8 most recent adverts. Each line is {pubkey-prefix}:{timestamp}:{snr*4}.' }),
    C('neighbor.remove', 'Neighbors', 'Remove a neighbor from the list', { danger: true, spec: '<pubkey_prefix>', args: [{ name: 'pubkey_prefix', hint: 'short prefix or full key' }], note: 'A single space as the prefix removes every neighbor.' }),
    C('discover.neighbors', 'Neighbors', 'Probe for zero-hop neighbors', { rx: 2 }),

    // ── Statistics ─────────────────────────────────────────────────────
    C('clear stats', 'Statistics', 'Reset all counters'),
    C('stats-core', 'Statistics', 'Battery, uptime, queue length, debug flags', { serial: true, rx: 2 }),
    C('stats-radio', 'Statistics', 'Noise floor, last RSSI/SNR, airtime, rx errors', { serial: true, rx: 2 }),
    C('stats-packets', 'Statistics', 'Packet counters — received and sent', { serial: true, rx: 2 }),

    // ── Logging ────────────────────────────────────────────────────────
    C('log start', 'Logging', 'Begin capturing the rx log to node storage'),
    C('log stop', 'Logging', 'Stop capturing the rx log'),
    C('log erase', 'Logging', 'Erase the captured log', { danger: true, note: 'Deletes the captured rx log from node storage. Download it first if you still need it.' }),
    C('log', 'Logging', 'Print the captured log to serial', { serial: true, rx: 4 }),

    // ── Info ───────────────────────────────────────────────────────────
    C('ver', 'Info', 'Firmware version'),
    C('board', 'Info', 'Hardware name'),
    C('get role', 'Info', 'Configured role', { key: 'role' }),
    C('get public.key', 'Info', 'This node’s public key', { key: 'public.key', rx: 2 }),

    // ── Radio ──────────────────────────────────────────────────────────
    C('get radio', 'Radio', 'Radio parameters — freq, bw, sf, cr', { key: 'radio' }),
    C('set radio', 'Radio', 'Change radio parameters', {
      admin: true, reboot: true, key: 'radio', spec: '<freq>,<bw>,<sf>,<cr>', def: '869.525,250,11,5',
      args: [{ name: 'freq', hint: 'MHz' }, { name: 'bw', hint: 'kHz' }, { name: 'sf', hint: '5–12' }, { name: 'cr', hint: '5–8' }],
      presets: [
        { value: '869.525,250,11,5', label: 'EU 868 default', note: 'firmware default' },
        { value: '910.525,250,11,5', label: 'US 915', note: 'US/ANZ common' },
        { value: '869.525,250,10,5', label: 'Faster SF10', note: '≈2× throughput, less range' },
      ],
    }),
    C('get tx', 'Radio', 'Transmit power', { key: 'tx' }),
    C('set tx', 'Radio', 'Change transmit power', {
      admin: true, key: 'tx', spec: '<dbm>', args: [{ name: 'dbm', hint: '1–22', range: [1, 22] }],
      note: 'Controls the LoRa chip only. Boards with a PA stage output more. Too high may be unlawful in your region.',
      presets: [{ value: '22', label: '22 dBm', note: 'max' }, { value: '17', label: '17 dBm' }, { value: '14', label: '14 dBm', note: 'EU limit w/ antenna gain' }],
    }),
    C('tempradio', 'Radio', 'Change radio parameters temporarily', {
      admin: true, spec: '<freq>,<bw>,<sf>,<cr>,<timeout_mins>',
      note: 'Not saved to preferences — clears on reboot. Your escape hatch if a `set radio` locks you out.',
      presets: [{ value: '869.525,250,10,5,10', label: 'SF10 for 10 min' }],
    }),
    C('get freq', 'Radio', 'Operating frequency', { key: 'freq' }),
    C('set freq', 'Radio', 'Change the operating frequency', { serial: true, admin: true, reboot: true, key: 'freq', spec: '<frequency>' }),
    C('get radio.rxgain', 'Radio', 'Rx boosted gain mode', { key: 'radio.rxgain', fw: '1.14.1' }),
    C('set radio.rxgain', 'Radio', 'Toggle rx boosted gain', { admin: true, fw: '1.14.1', key: 'radio.rxgain', args: onOff('radio.rxgain') }),

    // ── System ─────────────────────────────────────────────────────────
    C('get name', 'System', 'Node name', { key: 'name' }),
    C('set name', 'System', 'Rename this node', { admin: true, key: 'name', spec: '<name>', note: 'Max 24 bytes when a location is set, 32 otherwise. Emoji cost several bytes each.' }),
    C('get lat', 'System', 'Latitude', { key: 'lat' }),
    C('set lat', 'System', 'Set latitude', { admin: true, key: 'lat', spec: '<degrees>' }),
    C('get lon', 'System', 'Longitude', { key: 'lon' }),
    C('set lon', 'System', 'Set longitude', { admin: true, key: 'lon', spec: '<degrees>' }),
    C('get prv.key', 'System', 'Private key', { serial: true, admin: true, danger: true, rx: 2 }),
    C('set prv.key', 'System', 'Replace this node’s identity', { admin: true, danger: true, reboot: true, spec: '<private_key>', note: 'Replacing the identity orphans every contact that knows this repeater.' }),
    C('password', 'System', 'Change the admin password', { admin: true, danger: true, spec: '<new_password>', note: 'The reply echoes the new password. Any node using it is added to the admin ACL.' }),
    C('get guest.password', 'System', 'Guest password', { admin: true, key: 'guest.password' }),
    C('set guest.password', 'System', 'Change the guest password', { admin: true, key: 'guest.password', spec: '<password>' }),
    C('get owner.info', 'System', 'Owner info text', { fw: '1.12', key: 'owner.info' }),
    C('set owner.info', 'System', 'Set owner info text', { admin: true, fw: '1.12', key: 'owner.info', spec: '<text>', note: '`|` characters become newlines.' }),
    C('get adc.multiplier', 'System', 'Battery reading calibration', { key: 'adc.multiplier' }),
    C('set adc.multiplier', 'System', 'Fine-tune the battery reading', { admin: true, key: 'adc.multiplier', spec: '<value>', args: [{ name: 'value', hint: '0.0–10.0', range: [0, 10] }] }),
    C('powersaving', 'System', 'Power saving flag', { admin: true, key: 'powersaving', args: onOff('powersaving'), note: 'Sleeps between transmissions. Repeater only.' }),

    // ── Routing ────────────────────────────────────────────────────────
    C('get repeat', 'Routing', 'Repeat flag', { key: 'repeat' }),
    C('set repeat', 'Routing', 'Enable or disable repeating', { admin: true, key: 'repeat', args: onOff('repeat'), note: 'Turning this off silently removes the node from the mesh.' }),
    C('get path.hash.mode', 'Routing', 'Advert path hash size', { fw: '1.14', key: 'path.hash.mode' }),
    C('set path.hash.mode', 'Routing', 'Change advert path hash size', {
      admin: true, fw: '1.14', key: 'path.hash.mode',
      args: [{ name: 'value', enum: ['0', '1', '2'], enumDesc: { '0': '1 byte · 256 ids · 64 max flood', '1': '2 bytes · 65,536 ids · 32 max flood', '2': '3 bytes · 16.7M ids · 21 max flood' } }],
      note: 'Firmware ≤1.13 drops multibyte path hashes — raising this can limit flood propagation until your mesh has upgraded.',
    }),
    C('get loop.detect', 'Routing', 'Loop detection mode', { fw: '1.14', key: 'loop.detect' }),
    C('set loop.detect', 'Routing', 'Change loop detection', {
      admin: true, fw: '1.14', key: 'loop.detect',
      args: [{ name: 'state', enum: ['off', 'minimal', 'moderate', 'strict'], enumDesc: { off: 'no loop detection', minimal: 'drop at 4+ occurrences (1-byte)', moderate: 'drop at 2+ occurrences (1-byte)', strict: 'drop at 1+ occurrence (1-byte)' } }],
    }),
    C('get txdelay', 'Routing', 'Flood retransmit delay factor', { key: 'txdelay' }),
    C('set txdelay', 'Routing', 'Change the flood retransmit delay factor', { admin: true, key: 'txdelay', args: [{ name: 'value', hint: '0–2', range: [0, 2] }], note: 'Scales the random back-off window before retransmitting a flood packet. Higher = fewer collisions, more latency. 0 disables it.' }),
    C('get direct.txdelay', 'Routing', 'Direct retransmit delay factor', { key: 'direct.txdelay' }),
    C('set direct.txdelay', 'Routing', 'Change the direct retransmit delay factor', { admin: true, key: 'direct.txdelay', args: [{ name: 'value', hint: '0–2', range: [0, 2] }] }),
    C('get rxdelay', 'Routing', 'Receive processing delay', { experimental: true, key: 'rxdelay' }),
    C('set rxdelay', 'Routing', 'Change the receive processing delay', { admin: true, experimental: true, key: 'rxdelay', args: [{ name: 'value', hint: '0–20', range: [0, 20] }], note: 'Holds weak-signal copies in a queue so strong-signal paths forward first.' }),
    C('get dutycycle', 'Routing', 'Duty cycle limit', { fw: '1.15', key: 'dutycycle' }),
    C('set dutycycle', 'Routing', 'Change the duty cycle limit', {
      admin: true, fw: '1.15', key: 'dutycycle',
      args: [{ name: 'value', hint: '1–100 %', range: [1, 100] }],
      presets: [{ value: '100', label: 'Unlimited' }, { value: '50', label: '50%', note: 'default' }, { value: '10', label: '10%', note: 'EU 868' }, { value: '1', label: '1%', note: 'strictest EU' }],
    }),
    C('get af', 'Routing', 'Airtime factor', { deprecated: '1.15', key: 'af' }),
    C('set af', 'Routing', 'Change the airtime factor', { admin: true, deprecated: '1.15', key: 'af', args: [{ name: 'value', hint: '0–9', range: [0, 9] }], note: 'Superseded by `set dutycycle`.' }),
    C('get multi.acks', 'Routing', 'Multi-acks support', { key: 'multi.acks' }),
    C('set multi.acks', 'Routing', 'Enable or disable multi-acks', { admin: true, key: 'multi.acks', args: [{ name: 'state', enum: ['0', '1'], enumDesc: { '0': 'disabled', '1': 'enabled' } }] }),
    C('get flood.advert.interval', 'Routing', 'Flood advert interval', { key: 'flood.advert.interval' }),
    C('set flood.advert.interval', 'Routing', 'Change the flood advert interval', { admin: true, key: 'flood.advert.interval', args: [{ name: 'hours', hint: '3–168', range: [3, 168] }] }),
    C('get advert.interval', 'Routing', 'Zero-hop advert interval', { key: 'advert.interval' }),
    C('set advert.interval', 'Routing', 'Change the zero-hop advert interval', { admin: true, key: 'advert.interval', args: [{ name: 'minutes', hint: '60–240', range: [0, 240] }] }),
    C('get flood.max', 'Routing', 'Max hops for a flood message', { key: 'flood.max' }),
    C('set flood.max', 'Routing', 'Limit hops for a flood message', { admin: true, key: 'flood.max', args: [{ name: 'value', hint: '0–64', range: [0, 64] }] }),
    C('get flood.max.advert', 'Routing', 'Max hops for an advert flood', { key: 'flood.max.advert' }),
    C('set flood.max.advert', 'Routing', 'Limit hops for an advert flood', { admin: true, key: 'flood.max.advert', args: [{ name: 'value', hint: '0–64', range: [0, 64] }] }),

    // ── ACL ────────────────────────────────────────────────────────────
    C('get acl', 'ACL', 'View the current ACL', { serial: true, rx: 4 }),
    C('setperm', 'ACL', 'Add, update or remove a companion’s permissions', {
      admin: true, spec: '<pubkey> <permissions>',
      args: [{ name: 'pubkey', hint: 'companion public key' }, { name: 'permissions', enum: ['0', '1', '2', '3'], enumDesc: { '0': 'Guest', '1': 'Read-only', '2': 'Read-write', '3': 'Admin' } }],
      note: 'Omit permissions to remove the entry entirely.',
    }),
    C('get allow.read.only', 'ACL', 'Room server read-only flag', { key: 'allow.read.only' }),
    C('set allow.read.only', 'ACL', 'Change the read-only flag', { admin: true, key: 'allow.read.only', args: onOff('allow.read.only') }),

    // ── Region ─────────────────────────────────────────────────────────
    C('region', 'Region', 'Dump all regions and flood permissions', { fw: '1.10', rx: 3 }),
    C('region save', 'Region', 'Persist region changes made since reboot', { admin: true, fw: '1.10' }),
    C('region allowf', 'Region', 'Allow flooding for a region', { admin: true, fw: '1.10', spec: '<name>', args: [{ name: 'name', hint: 'region name or *' }] }),
    C('region denyf', 'Region', 'Block flooding for a region', { admin: true, fw: '1.10', spec: '<name>', args: [{ name: 'name', hint: 'region name or *' }] }),
    C('region put', 'Region', 'Create a new region', { admin: true, fw: '1.10', spec: '<name> [parent_name]' }),
    C('region remove', 'Region', 'Remove a region', { admin: true, fw: '1.10', danger: true, spec: '<name>', note: 'All child regions must be removed first.' }),
    C('region list', 'Region', 'View all regions', { serial: true, fw: '1.12', spec: '<filter>', args: [{ name: 'filter', enum: ['allowed', 'denied'] }] }),

    // ── GPS ────────────────────────────────────────────────────────────
    C('gps', 'GPS', 'GPS state', { key: 'gps', args: onOff('gps') }),
    C('gps sync', 'GPS', 'Sync the clock with GPS time', { admin: true }),
    C('gps setloc', 'GPS', 'Set location from GPS coordinates', { admin: true }),
    C('gps advert', 'GPS', 'GPS advert policy', { admin: true, args: [{ name: 'policy', enum: ['none', 'share', 'prefs'], enumDesc: { none: 'never include location', share: 'share live GPS location', prefs: 'use stored lat/lon' } }] }),
  ];

  const groupOrder = ['Operational', 'Neighbors', 'Statistics', 'Logging', 'Info', 'Radio', 'System', 'Routing', 'ACL', 'Region', 'GPS'];

  // ── LiquidJS ─────────────────────────────────────────────────────────
  // Same variable vocabulary as the Macros tool, narrowed to what makes sense
  // when the "peer" is a repeater you are administering.
  const V = (name, kind, desc, sample) => ({ name, kind, desc, sample });
  const liquidVars = [
    V('node_name', 'text', 'Name of the repeater you are addressing', 'egrme.sh RAK3401'),
    V('node_id', 'id', 'Its short node ID', '42da74'),
    V('node_pubkey', 'id', 'Its full public key', '42da74…d8e5'),
    V('node_pos', 'pos', 'Its position {lat, lon}', '30.21143, -97.76217'),
    V('node_hops', 'num', 'Hops away', '3'),
    V('node_snr', 'num', 'Last SNR (dB)', '6.5'),
    V('node_rssi', 'num', 'Last RSSI (dBm)', '-84'),
    V('my_name', 'text', 'Your node’s display name', 'egrme.sh Hand'),
    V('my_id', 'id', 'Your node ID', '200b5a'),
    V('my_pos', 'pos', 'Your position {lat, lon}', '30.2849, -97.7341'),
    V('my_battery_v', 'num', 'Your battery, volts', '4.08'),
    V('now', 'time', 'Current time', '2026-07-27 14:32'),
    V('epoch', 'num', 'Current Unix epoch seconds', '1785207004'),
  ];
  const F = (name, custom, sig, desc) => ({ name, custom, sig, desc });
  const liquidFilters = [
    F('distance', true, 'distance: pos', 'Great-circle distance to another point → metres'),
    F('bearing', true, 'bearing: pos', 'Initial bearing to another point → degrees'),
    F('unit', true, 'unit: "km"', 'Convert a number to km / mi / ft'),
    F('round', false, 'round: 1', 'Round to N decimal places'),
    F('date', false, 'date: "%s"', 'Format a timestamp'),
    F('truncate', false, 'truncate: 24', 'Cut to N characters'),
    F('upcase', false, 'upcase', 'Uppercase'),
    F('default', false, 'default: "n/a"', 'Fallback when empty'),
  ];

  const macros = [
    { name: 'nightly-check', body: 'get dutycycle', desc: 'Duty cycle spot check' },
    { name: 'retune-us', body: 'set radio 910.525,250,11,5', desc: 'Retune to the US 915 plan' },
    { name: 'locate', body: 'set lat {{ my_pos.lat }}', desc: 'Copy your own latitude to the node' },
    { name: 'health', body: 'ver', desc: 'Firmware + board fingerprint' },
  ];

  // Values the mock resolves {{ }} against.
  const liquidCtx = {
    node_name: 'egrme.sh RAK3401', node_id: '42da74', node_pubkey: '42da74…d8e5',
    node_pos: '30.21143, -97.76217', node_hops: '3', node_snr: '6.5', node_rssi: '-84',
    my_name: 'egrme.sh Hand', my_id: '200b5a', my_pos: '30.2849, -97.7341',
    my_battery_v: '4.08', now: '2026-07-27 14:32', epoch: '1785207004',
  };

  const seedHistory = [
    { text: 'ver', status: 'ok' },
    { text: 'get radio', status: 'ok' },
    { text: 'set tx 22', status: 'ok' },
    { text: 'neighbors', status: 'ok' },
    { text: 'get acl', status: 'error' },
    { text: 'set dutycycle 10', status: 'ok' },
    { text: 'reboot', status: 'noreply' },
    { text: 'get loop.detect', status: 'ok' },
    { text: 'set repeat on', status: 'ok' },
    { text: 'discover.neighbors', status: 'timeout' },
    { text: 'get flood.max', status: 'ok' },
    { text: 'set name egrme.sh RAK3401', status: 'ok' },
  ];

  const recent = ['get radio', 'neighbors', 'set tx', 'ver', 'get dutycycle'];

  return { node, commands, groupOrder, liquidVars, liquidFilters, liquidCtx, macros, seedHistory, recent };
})();
