// mac-data.js — the macro feature's domain data:
//   • variables[]  — the full catalog (always vs reply-only), with sample
//                     display strings for the reference panel
//   • filters      — custom MeshCore filters + standard Liquid array filters
//   • contexts     — concrete sample data the preview evaluates against, one
//                     per preview mode (reply / send) plus a worst-case ("max")
//   • examples[]   — starter macros for the library
//
// Sample identity/radio values mirror the rest of the CoreSense mocks
// (egrme.sh Hand, node 200b5a, Heltec V3 …) so the tool feels in-context.

window.MAC_DATA = (() => {
  // ── Relay paths for the reply sample (strongest = highest final_snr) ──
  const origin = { kind: 'origin', short_id: '7b', name: 'Karin VK3', pk: '7b21d0c9' };
  const sink   = { kind: 'sink',   short_id: 'eH', name: 'egrme.sh Hand', pk: '200b5a11' };
  const rep = (short_id, name, pk) => ({ kind: 'repeater', short_id, name, pk });

  const paths = [
    { id: 'p3', length: 1, hash_mode: 'direct', final_snr: -2.5,
      hops: [origin, sink] },
    { id: 'p1', length: 2, hash_mode: 'flood', final_snr: 4.2,
      hops: [origin, rep('82', 'Mueller Repeater', '82a3'), sink] },
    { id: 'p2', length: 3, hash_mode: 'flood', final_snr: 9.1,
      hops: [origin, rep('a9', 'UT2 AustinMesh', 'a9f1'), rep('2c', 'Bender DT 🏙️', '2c44'), sink] },
  ];

  // ── Reply context — clicking a received message; everything available ──
  const reply = {
    my_name: 'egrme.sh Hand', my_callsign: 'egrme',
    my_id: '200b5a', my_pubkey: 'ffcf7fcd0cc859d38bf7867f87a8d6fe',
    my_pos: { lat: 30.2849, lon: -97.7341 },
    my_battery_mv: 4160, my_battery_v: 4.16,
    channel: '',
    peer_name: 'Karin VK3', peer_id: '7b21d0',
    peer_pos: { lat: 30.3210, lon: -97.7800 },
    peer_last_seen: '2m ago', peer_rssi: -84, peer_snr: 6.5, peer_hops: 2,
    // reply-only
    message_body: 'Anyone near Mt Bonnell for a relay test?',
    msg_time: '14:32', received_ago: '2m ago',
    sender_name: 'Karin VK3', sender_id: '7b21d0',
    sender_pos: { lat: 30.3210, lon: -97.7800 },
    rssi: -84, snr: 6.5, hops: 2, times_heard: 5,
    paths,
  };

  // ── New-send context — composing a DM to a contact. Only "always" vars
  //    are populated; reply-only keys are absent (→ unavailable).
  const send = {
    my_name: 'egrme.sh Hand', my_callsign: 'egrme',
    my_id: '200b5a', my_pubkey: 'ffcf7fcd0cc859d38bf7867f87a8d6fe',
    my_pos: { lat: 30.2849, lon: -97.7341 },
    my_battery_mv: 4160, my_battery_v: 4.16,
    channel: '',
    peer_name: 'Mt. Bonnell 🗻', peer_id: 'a8c1f0',
    peer_pos: { lat: 30.3210, lon: -97.7720 },
    peer_last_seen: '18m ago', peer_rssi: -72, peer_snr: 8.0, peer_hops: 1,
  };

  // ── Worst-case context — longest plausible values, for the budget meter.
  //    (Variables expand unpredictably; this estimates the upper bound.)
  const longPaths = [
    { id: 'x', length: 4, hash_mode: 'flood', final_snr: 11.0,
      hops: [
        { kind: 'origin', short_id: 'c5', name: 'EDM9/R Edwards Mtn', pk: 'c5' },
        rep('a1', 'Tarrytown East Solar', 'a1'),
        rep('37', 'SOCO RAK Repeater 🛒', '37'),
        rep('a8', 'Mt. Bonnell 🗻', 'a8'),
        sink ],
    },
  ];
  const max = {
    ...reply,
    my_name: 'egrme.sh Field Station 2', my_callsign: 'egrme-2',
    peer_name: 'Tarrytown East Solar Repeater',
    sender_name: 'Tarrytown East Solar Repeater',
    message_body: 'Anyone near Mt Bonnell for a relay test this evening please?',
    received_ago: '14m ago', peer_last_seen: '14m ago',
    rssi: -118, snr: -7.5, hops: 7, times_heard: 142,
    paths: longPaths,
  };

  // ── Variable catalog (drives the reference panel + validator) ─────────
  // kind only affects the little type tag shown in the reference list.
  const V = (name, group, kind, desc, sample) => ({ name, group, kind, desc, sample });
  const variables = [
    // always — identity
    V('my_name',       'always', 'text', 'Your node’s display name', 'egrme.sh Hand'),
    V('my_callsign',   'always', 'text', 'Your callsign, if set', 'egrme'),
    V('my_id',         'always', 'id',   'Your node ID (short hex)', '200b5a'),
    V('my_pubkey',     'always', 'id',   'Your full public key', 'ffcf7f…d6fe'),
    V('my_pos',        'always', 'pos',  'Your position {lat, lon} — may be empty', '30.2849, -97.7341'),
    V('my_battery_mv', 'always', 'num',  'Battery, millivolts', '4160'),
    V('my_battery_v',  'always', 'num',  'Battery, volts', '4.16'),
    V('channel',       'always', 'text', 'Channel name — empty in a DM', '#testing'),
    // always — peer (the contact you’re addressing)
    V('peer_name',     'always', 'text', 'Name of the contact you’re addressing', 'Karin VK3'),
    V('peer_id',       'always', 'id',   'Their node ID', '7b21d0'),
    V('peer_pos',      'always', 'pos',  'Their position {lat, lon}', '30.3210, -97.7800'),
    V('peer_last_seen','always', 'time', 'When you last heard them', '2m ago'),
    V('peer_rssi',     'always', 'num',  'Their last RSSI (dBm)', '-84'),
    V('peer_snr',      'always', 'num',  'Their last SNR (dB)', '6.5'),
    V('peer_hops',     'always', 'num',  'Hops away', '2'),
    // reply-only — the message
    V('message_body',  'reply', 'text', 'Body of the message you’re replying to', 'Anyone near Mt Bonnell…'),
    V('msg_time',      'reply', 'time', 'When it was sent', '14:32'),
    V('received_ago',  'reply', 'time', 'How long ago it arrived', '2m ago'),
    V('sender_name',   'reply', 'text', 'Who sent it', 'Karin VK3'),
    V('sender_id',     'reply', 'id',   'Sender’s node ID', '7b21d0'),
    V('sender_pos',    'reply', 'pos',  'Sender’s position {lat, lon}', '30.3210, -97.7800'),
    V('rssi',          'reply', 'num',  'This message’s RSSI (dBm)', '-84'),
    V('snr',           'reply', 'num',  'This message’s SNR (dB)', '6.5'),
    V('hops',          'reply', 'num',  'Hops this message took', '2'),
    V('times_heard',   'reply', 'num',  'How many copies you heard', '5'),
    V('paths',         'reply', 'array','Relay paths this message took (array)', '3 paths'),
  ];

  // ── Filter catalog ────────────────────────────────────────────────────
  const F = (name, custom, sig, desc, example) => ({ name, custom, sig, desc, example });
  const filters = [
    F('distance', true, 'distance: pos', 'Great-circle distance to another point → meters', '{{ my_pos | distance: peer_pos }}'),
    F('bearing',  true, 'bearing: pos',  'Compass bearing to another point', '{{ my_pos | bearing: peer_pos }}'),
    F('unit',     true, "unit: 'km'",    'Format a distance; auto sub-km → m, respects km/mi setting', "{{ my_pos | distance: peer_pos | unit: 'km' }}"),
    F('first', false, 'first', 'First item of an array', '{{ paths | first }}'),
    F('last',  false, 'last',  'Last item of an array', '{{ paths | sort: "final_snr" | last }}'),
    F('map',   false, 'map: "key"', 'Pull one property from each item', '{{ paths | last | map: "name" }}'),
    F('join',  false, 'join: " → "', 'Join an array into a string', '{{ list | join: " → " }}'),
    F('sort',  false, 'sort: "key"', 'Sort an array (by key for objects)', '{{ paths | sort: "final_snr" }}'),
    F('size',  false, 'size', 'Number of items / characters', '{{ paths | size }}'),
  ];

  // ── Starter macros for the library ─────────────────────────────────────
  const M = (id, name, scope, scopeLabel, mode, template, updated) =>
    ({ id, name, scope, scopeLabel, mode, template, updated });
  const examples = [
    M('m1', 'Signal report', 'global', null, 'reply',
      '{{sender_name}}: {{rssi}}dBm / {{snr}} snr · {{hops}} hops', '2d ago'),
    M('m2', 'Distance to you', 'global', null, 'both',
      '{{ my_pos | distance: peer_pos | unit: \'km\' }} away · {{ my_pos | bearing: peer_pos }}', '5d ago'),
    M('m3', 'Relay path', 'channel', '#testing', 'reply',
      'Heard via {{ paths | sort: "final_snr" | last | map: "name" | join: " → " }}', '1w ago'),
    M('m4', 'Ack + copy', 'global', null, 'reply',
      '✓ {{sender_name}}, copy at {{snr}} snr. ({{received_ago}})', '1w ago'),
    M('m5', 'My beacon', 'global', null, 'send',
      '{{my_name}} ({{my_id}}) · {{my_pos.lat}},{{my_pos.lon}} · {{my_battery_v}}V', '2w ago'),
    M('m6', 'Repeater nudge', 'contact', 'Mt. Bonnell 🗻', 'send',
      '{{peer_name}} — you’re {{peer_hops}} hops out, last seen {{peer_last_seen}}.', '3w ago'),
  ];

  return { variables, filters, contexts: { reply, send, max }, examples };
})();
