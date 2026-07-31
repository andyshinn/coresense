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

// Populated group-by-group across Tasks 2–5. Empty until then.
export const CLI_COMMANDS: readonly CliCommand[] = [];

export const CLI_BY_NAME: Readonly<Record<string, CliCommand>> = Object.freeze(
  Object.fromEntries(CLI_COMMANDS.map((c) => [c.name, c])),
);
