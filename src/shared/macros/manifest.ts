import type { MacroContext, MacroFilterDoc, MacroManifest, MacroVariable } from './types';

export const MACRO_VARIABLES: MacroVariable[] = [
  { name: 'my_name', description: 'Your node name', type: 'string', example: 'N0CALL', available: 'always' },
  { name: 'my_callsign', description: 'Alias of my_name', type: 'string', example: 'N0CALL', available: 'always' },
  { name: 'my_id', description: 'Your short public-key id', type: 'string', example: 'a1b2c3d4', available: 'always' },
  { name: 'my_pubkey', description: 'Your full public key', type: 'string', example: 'a1b2c3d4...', available: 'always' },
  {
    name: 'my_pos',
    description: 'Your position {lat, lon}',
    type: 'position',
    example: '{{ my_pos.lat }}',
    available: 'always',
  },
  { name: 'my_battery_mv', description: 'Your battery in millivolts', type: 'number', example: '4100', available: 'always' },
  { name: 'my_battery_v', description: 'Your battery in volts', type: 'number', example: '4.1', available: 'always' },
  {
    name: 'channel',
    description: 'Active channel name (empty in a DM)',
    type: 'string',
    example: 'General',
    available: 'always',
  },
  {
    name: 'peer_name',
    description: 'The contact you are addressing',
    type: 'string',
    example: 'Alice',
    available: 'always',
  },
  { name: 'peer_id', description: "The peer's public key", type: 'string', example: 'abcd...', available: 'always' },
  {
    name: 'peer_pos',
    description: "The peer's last position {lat, lon}",
    type: 'position',
    example: '{{ peer_pos.lat }}',
    available: 'always',
  },
  {
    name: 'peer_last_seen',
    description: 'Epoch ms the peer was last heard',
    type: 'number',
    example: '1700000000000',
    available: 'always',
  },
  { name: 'peer_rssi', description: "The peer's last-heard RSSI", type: 'number', example: '-80', available: 'always' },
  { name: 'peer_snr', description: "The peer's last-heard SNR", type: 'number', example: '7', available: 'always' },
  { name: 'peer_hops', description: "The peer's last-heard hop count", type: 'number', example: '1', available: 'always' },
  { name: 'message_body', description: 'The replied-to message text', type: 'string', example: 'hello', available: 'reply' },
  {
    name: 'msg_time',
    description: 'Epoch ms of the replied-to message',
    type: 'number',
    example: '1700000000000',
    available: 'reply',
  },
  {
    name: 'received_ago',
    description: 'Humanised time since the message',
    type: 'string',
    example: '5m',
    available: 'reply',
  },
  { name: 'sender_name', description: 'Message author name', type: 'string', example: 'Alice', available: 'reply' },
  { name: 'sender_id', description: 'Message author public key', type: 'string', example: 'abcd...', available: 'reply' },
  {
    name: 'sender_pos',
    description: "Message author's position {lat, lon}",
    type: 'position',
    example: '{{ sender_pos.lat }}',
    available: 'reply',
  },
  { name: 'rssi', description: "This message's RSSI", type: 'number', example: '-95', available: 'reply' },
  { name: 'snr', description: "This message's SNR", type: 'number', example: '5.5', available: 'reply' },
  { name: 'hops', description: "This message's hop count", type: 'number', example: '2', available: 'reply' },
  { name: 'times_heard', description: 'Distinct receptions merged', type: 'number', example: '3', available: 'reply' },
  {
    name: 'paths',
    description: 'Relay paths this message took',
    type: 'array',
    example: '{{ paths | size }}',
    available: 'reply',
  },
];

export const MACRO_FILTERS: MacroFilterDoc[] = [
  {
    name: 'distance',
    description: 'Great-circle distance in metres between two positions',
    signature: '{{ a | distance: b }}',
    example: '{{ my_pos | distance: peer_pos }}',
  },
  {
    name: 'bearing',
    description: 'Initial bearing as degrees + compass point',
    signature: '{{ a | bearing: b }}',
    example: '{{ my_pos | bearing: peer_pos }}',
  },
  {
    name: 'unit',
    description: 'Format metres as km/mi (auto sub-unit)',
    signature: "{{ metres | unit: 'km' }}",
    example: '{{ my_pos | distance: peer_pos | unit }}',
  },
];

export function getManifest(): MacroManifest {
  return { variables: MACRO_VARIABLES, filters: MACRO_FILTERS };
}

export function buildSampleContext(): MacroContext {
  return {
    my_name: 'N0CALL',
    my_callsign: 'N0CALL',
    my_id: 'a1b2c3d4',
    my_pubkey: 'a1b2c3d4e5f6',
    my_pos: { lat: 37.7749, lon: -122.4194 },
    my_battery_mv: 4100,
    my_battery_v: 4.1,
    channel: 'General',
    peer_name: 'Alice',
    peer_id: 'c0ffee00',
    peer_pos: { lat: 37.8044, lon: -122.2712 },
    peer_last_seen: 1700000000000,
    peer_rssi: -80,
    peer_snr: 7,
    peer_hops: 1,
    message_body: 'hello there',
    msg_time: 1700000000000,
    received_ago: '5m',
    sender_name: 'Alice',
    sender_id: 'c0ffee00',
    sender_pos: { lat: 37.8044, lon: -122.2712 },
    rssi: -95,
    snr: 5.5,
    hops: 2,
    times_heard: 3,
    paths: [
      {
        id: 'p1',
        length: 2,
        hash_mode: 1,
        final_snr: 6.5,
        hops: [
          { kind: 'origin', short_id: 'aa', name: 'Alice', pk: 'c0ffee00' },
          { kind: 'sink', short_id: 'bb', name: 'Me', pk: 'a1b2c3d4e5f6' },
        ],
      },
    ],
  };
}
