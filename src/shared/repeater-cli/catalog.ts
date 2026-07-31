// MeshCore repeater CLI catalog — pure data + types, no React, no renderer
// imports. Mirrors src/shared/macros/manifest.ts.
//
// Each entry carries the metadata that matters over LoRa: group, description,
// argument shapes, enums with per-value descriptions, presets, get/set pairing
// (`key`), firmware floor (annotation only), and the serial-only / no-reply /
// reboot-required / destructive flags that decide whether a user waits 30
// seconds for silence.
//
// AUTHORITY: docs/firmware/CommonCLI.cpp (shared dispatcher) and
// docs/firmware/MyMeshRepeater.cpp (three repeater-local handlers). The mockup
// at .design-ref/cli-autocomplete/cli-data.js is the port source, distilled
// from docs and wrong in places; every entry is reconciled against firmware.
// Dropped from the mockup: `admin` (firmware gates ALL mesh CLI on admin — a
// tab condition, §0), `rx` (replies are always one packet), `alias` (unused).

export type CliGroup =
  | 'Operational'
  | 'Neighbors'
  | 'Statistics'
  | 'Logging'
  | 'Info'
  | 'Radio'
  | 'System'
  | 'Routing'
  | 'ACL'
  | 'Region'
  | 'GPS';

export interface CliArg {
  name: string;
  hint?: string; // '5–12', 'MHz', 'companion public key'
  enum?: string[];
  enumDesc?: Record<string, string>;
  range?: [number, number]; // rendered in the detail pane; NOT validated
}

export interface CliPreset {
  value: string;
  label: string;
  note?: string;
}

export interface CliCommand {
  name: string; // 'set radio' — longest match wins over 'set'
  group: CliGroup;
  desc: string;
  spec?: string; // '<freq>,<bw>,<sf>,<cr>' — ghost + detail hint
  args?: CliArg[];
  presets?: CliPreset[];
  key?: string; // pairs get/set, drives "on node now"
  replyValue?: RegExp; // extracts the bare value from a get reply (§2.3)
  def?: string;
  serialOnly?: true;
  noReply?: true;
  reboot?: true;
  danger?: true;
  fw?: string; // annotation only, never gates
  deprecated?: string;
  experimental?: true;
  note?: string;
}

/** Firmware `get` replies are uniformly prefixed with "> " (CommonCLI.cpp
 *  handleGetCmd). Capture group 1 is the bare value. */
export const GET_VALUE = /^>\s*([\s\S]+?)\s*$/;

/** Shared on/off argument. The mockup put the get/set `key` on the arg; our
 *  CliArg has no key field — the command carries `key`, the arg carries enum. */
export const onOff: CliArg[] = [{ name: 'state', enum: ['on', 'off'] }];

export const CLI_GROUP_ORDER: readonly CliGroup[] = [
  'Operational',
  'Neighbors',
  'Statistics',
  'Logging',
  'Info',
  'Radio',
  'System',
  'Routing',
  'ACL',
  'Region',
  'GPS',
];

const OPERATIONAL: CliCommand[] = [
  { name: 'reboot', group: 'Operational', desc: 'Restart the node', noReply: true },
  {
    name: 'poweroff',
    group: 'Operational',
    desc: 'Power the node down',
    noReply: true,
    danger: true,
    note: 'The node goes dark and cannot be woken over the air — someone must power-cycle it in person. `shutdown` is a firmware alias (CommonCLI.cpp:216).',
  },
  { name: 'clkreboot', group: 'Operational', desc: 'Reset the clock and reboot', noReply: true },
  { name: 'clock', group: 'Operational', desc: 'Display current time in UTC' },
  { name: 'clock sync', group: 'Operational', desc: 'Sync the clock with this device' },
  {
    name: 'time',
    group: 'Operational',
    desc: 'Set the time to a specific timestamp',
    spec: '<epoch_seconds>',
    args: [{ name: 'epoch_seconds', hint: 'Unix epoch time' }],
  },
  { name: 'advert', group: 'Operational', desc: 'Send a flood advert' },
  { name: 'advert.zerohop', group: 'Operational', desc: 'Send a zero-hop advert' },
  { name: 'start ota', group: 'Operational', desc: 'Begin an over-the-air firmware update' },
  {
    name: 'erase',
    group: 'Operational',
    desc: 'Factory reset — wipes all settings and keys',
    serialOnly: true,
    danger: true,
    note: 'Wipes settings, ACL and node identity. Serial console only — guarded by sender_timestamp == 0 (CommonCLI.cpp:302); over the air it returns "Unknown command".',
  },
];

const NEIGHBORS: CliCommand[] = [
  {
    name: 'neighbors',
    group: 'Neighbors',
    desc: 'List nearby neighbors',
    note: 'Limited to the 8 most recent adverts; each line is {pubkey-prefix}:{timestamp}:{snr*4}. The reply is one ≤160-byte packet and overflows/truncates (§0).',
  },
  {
    name: 'neighbor.remove',
    group: 'Neighbors',
    desc: 'Remove a neighbor from the list',
    danger: true,
    spec: '<pubkey_prefix>',
    args: [{ name: 'pubkey_prefix', hint: 'short prefix or full key' }],
    note: 'A single space as the prefix removes every neighbor.',
  },
  { name: 'discover.neighbors', group: 'Neighbors', desc: 'Probe for zero-hop neighbors' },
];

const STATISTICS: CliCommand[] = [
  { name: 'clear stats', group: 'Statistics', desc: 'Reset all counters' },
  {
    name: 'stats-core',
    group: 'Statistics',
    desc: 'Battery, uptime, queue length, debug flags',
    serialOnly: true,
    note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:474).',
  },
  {
    name: 'stats-radio',
    group: 'Statistics',
    desc: 'Noise floor, last RSSI/SNR, airtime, rx errors',
    serialOnly: true,
    note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:472).',
  },
  {
    name: 'stats-packets',
    group: 'Statistics',
    desc: 'Packet counters — received and sent',
    serialOnly: true,
    note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:470).',
  },
];

const LOGGING: CliCommand[] = [
  { name: 'log start', group: 'Logging', desc: 'Begin capturing the rx log to node storage' },
  { name: 'log stop', group: 'Logging', desc: 'Stop capturing the rx log' },
  {
    name: 'log erase',
    group: 'Logging',
    desc: 'Erase the captured log',
    danger: true,
    note: 'Deletes the captured rx log from node storage. Download it first if you still need it.',
  },
  {
    name: 'log',
    group: 'Logging',
    desc: 'Print the captured log to serial',
    serialOnly: true,
    note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:467).',
  },
];

const INFO: CliCommand[] = [
  { name: 'ver', group: 'Info', desc: 'Firmware version' },
  { name: 'board', group: 'Info', desc: 'Hardware name' },
  { name: 'get role', group: 'Info', desc: 'Configured role', key: 'role', replyValue: GET_VALUE },
  { name: 'get public.key', group: 'Info', desc: "This node's public key", key: 'public.key', replyValue: GET_VALUE },
];

const RADIO: CliCommand[] = [
  { name: 'get radio', group: 'Radio', desc: 'Radio parameters — freq, bw, sf, cr', key: 'radio', replyValue: GET_VALUE },
  {
    name: 'set radio',
    group: 'Radio',
    desc: 'Change radio parameters',
    reboot: true,
    key: 'radio',
    spec: '<freq>,<bw>,<sf>,<cr>',
    def: '869.525,250,11,5',
    args: [
      { name: 'freq', hint: 'MHz' },
      { name: 'bw', hint: 'kHz' },
      { name: 'sf', hint: '5–12', range: [5, 12] },
      { name: 'cr', hint: '5–8', range: [5, 8] },
    ],
    presets: [
      { value: '869.525,250,11,5', label: 'EU 868 default', note: 'firmware default' },
      { value: '910.525,250,11,5', label: 'US 915', note: 'US/ANZ common' },
      { value: '869.525,250,10,5', label: 'Faster SF10', note: '≈2× throughput, less range' },
    ],
  },
  { name: 'get tx', group: 'Radio', desc: 'Transmit power', key: 'tx', replyValue: GET_VALUE },
  {
    name: 'set tx',
    group: 'Radio',
    desc: 'Change transmit power',
    key: 'tx',
    spec: '<dbm>',
    args: [{ name: 'dbm', hint: '1–22', range: [1, 22] }],
    note: 'Controls the LoRa chip only; boards with a PA output more. Firmware clamps to -9..30 dBm. Too high may be unlawful in your region.',
    presets: [
      { value: '22', label: '22 dBm', note: 'max' },
      { value: '17', label: '17 dBm' },
      { value: '14', label: '14 dBm', note: 'EU limit w/ antenna gain' },
    ],
  },
  {
    name: 'tempradio',
    group: 'Radio',
    desc: 'Change radio parameters temporarily',
    spec: '<freq>,<bw>,<sf>,<cr>,<timeout_mins>',
    note: 'Not saved — clears on reboot. Your escape hatch if a `set radio` locks you out.',
    presets: [{ value: '869.525,250,10,5,10', label: 'SF10 for 10 min' }],
  },
  { name: 'get freq', group: 'Radio', desc: 'Operating frequency', key: 'freq', replyValue: GET_VALUE },
  {
    name: 'set freq',
    group: 'Radio',
    desc: 'Change the operating frequency',
    serialOnly: true,
    reboot: true,
    key: 'freq',
    spec: '<frequency>',
    note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:696).',
  },
  {
    name: 'get radio.rxgain',
    group: 'Radio',
    desc: 'Rx boosted gain mode',
    key: 'radio.rxgain',
    replyValue: GET_VALUE,
    fw: '1.14.1',
  },
  {
    name: 'set radio.rxgain',
    group: 'Radio',
    desc: 'Toggle rx boosted gain',
    key: 'radio.rxgain',
    fw: '1.14.1',
    args: onOff,
  },
  { name: 'get int.thresh', group: 'Radio', desc: 'Interference threshold', key: 'int.thresh', replyValue: GET_VALUE },
  {
    name: 'set int.thresh',
    group: 'Radio',
    desc: 'Change the interference threshold',
    key: 'int.thresh',
    spec: '<value>',
    args: [{ name: 'value', hint: 'threshold' }],
    note: 'Added in reconciliation — present in CommonCLI.cpp (set :499 / get :777), absent from the mockup.',
  },
  {
    name: 'get agc.reset.interval',
    group: 'Radio',
    desc: 'AGC reset interval',
    key: 'agc.reset.interval',
    replyValue: GET_VALUE,
  },
  {
    name: 'set agc.reset.interval',
    group: 'Radio',
    desc: 'Change the AGC reset interval',
    key: 'agc.reset.interval',
    spec: '<seconds>',
    args: [{ name: 'seconds', hint: 'rounded to a multiple of 4' }],
    note: 'Firmware divides by 4 on store and rounds the echo (CommonCLI.cpp:503).',
  },
];

const SYSTEM: CliCommand[] = [
  { name: 'get name', group: 'System', desc: 'Node name', key: 'name', replyValue: GET_VALUE },
  {
    name: 'set name',
    group: 'System',
    desc: 'Rename this node',
    key: 'name',
    spec: '<name>',
    note: 'Max 24 bytes when a location is set, 32 otherwise. Emoji cost several bytes each.',
  },
  { name: 'get lat', group: 'System', desc: 'Latitude', key: 'lat', replyValue: GET_VALUE },
  { name: 'set lat', group: 'System', desc: 'Set latitude', key: 'lat', spec: '<degrees>' },
  { name: 'get lon', group: 'System', desc: 'Longitude', key: 'lon', replyValue: GET_VALUE },
  { name: 'set lon', group: 'System', desc: 'Set longitude', key: 'lon', spec: '<degrees>' },
  {
    name: 'get prv.key',
    group: 'System',
    desc: 'Private key',
    serialOnly: true,
    danger: true,
    note: 'Serial only — guarded by sender_timestamp == 0 (CommonCLI.cpp:791).',
  },
  {
    name: 'set prv.key',
    group: 'System',
    desc: "Replace this node's identity",
    danger: true,
    reboot: true,
    spec: '<private_key>',
    note: 'Replacing the identity orphans every contact that knows this repeater.',
  },
  {
    name: 'password',
    group: 'System',
    desc: 'Change the admin password',
    danger: true,
    spec: '<new_password>',
    note: 'The reply echoes the new password. Any node using it is added to the admin ACL.',
  },
  { name: 'get guest.password', group: 'System', desc: 'Guest password', key: 'guest.password', replyValue: GET_VALUE },
  {
    name: 'set guest.password',
    group: 'System',
    desc: 'Change the guest password',
    key: 'guest.password',
    spec: '<password>',
  },
  { name: 'get owner.info', group: 'System', desc: 'Owner info text', key: 'owner.info', replyValue: GET_VALUE, fw: '1.12' },
  {
    name: 'set owner.info',
    group: 'System',
    desc: 'Set owner info text',
    key: 'owner.info',
    spec: '<text>',
    fw: '1.12',
    note: '`|` characters become newlines.',
  },
  {
    name: 'get adc.multiplier',
    group: 'System',
    desc: 'Battery reading calibration',
    key: 'adc.multiplier',
    replyValue: GET_VALUE,
  },
  {
    name: 'set adc.multiplier',
    group: 'System',
    desc: 'Fine-tune the battery reading',
    key: 'adc.multiplier',
    spec: '<value>',
    args: [{ name: 'value', hint: '0.0–10.0', range: [0, 10] }],
  },
  {
    name: 'powersaving',
    group: 'System',
    desc: 'Power saving flag',
    key: 'powersaving',
    args: onOff,
    note: 'Sleeps between transmissions. Repeater only.',
  },
];

// Populated group-by-group across Tasks 2–5.
export const CLI_COMMANDS: readonly CliCommand[] = [
  ...OPERATIONAL,
  ...NEIGHBORS,
  ...STATISTICS,
  ...LOGGING,
  ...INFO,
  ...RADIO,
  ...SYSTEM,
];

export const CLI_BY_NAME: Readonly<Record<string, CliCommand>> = Object.freeze(
  Object.fromEntries(CLI_COMMANDS.map((c) => [c.name, c])),
);
