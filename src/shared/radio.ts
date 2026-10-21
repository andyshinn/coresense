// Write validation for the companion radio's own settings, shared by the
// server's request schemas, the settings panels and the My Node console so
// every caller hits the same rejection with the same message.

import type { RadioLimits } from './types';

/** A validated, normalised value, or the reason it was refused. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Firmware stores the name in `char node_name[32]` (companion_radio
 *  NodePrefs.h) and CMD_SET_ADVERT_NAME silently truncates past 31 bytes,
 *  which can cut a multi-byte character in half. Refusing is safer. */
export const NODE_NAME_MAX_BYTES = 31;

// C0 controls, DEL and C1 controls.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** The name as it would be sent: surrounding whitespace trimmed, Unicode NFC. */
export function normalizeNodeName(raw: string): string {
  return raw.trim().normalize('NFC');
}

/** Validate a node name. The byte limit applies to the normalised string,
 *  which is what reaches the radio. */
export function validateNodeName(raw: string): Checked<string> {
  const name = normalizeNodeName(raw);
  if (name.length === 0) return { ok: false, error: 'Name must not be empty' };
  if (CONTROL_CHARS.test(name)) return { ok: false, error: 'Name must not contain control characters' };
  const bytes = new TextEncoder().encode(name).length;
  if (bytes > NODE_NAME_MAX_BYTES) {
    return { ok: false, error: `Name must be at most ${NODE_NAME_MAX_BYTES} bytes (it is ${bytes})` };
  }
  return { ok: true, value: name };
}

/** Validate a TX power against the connected radio's range. With the board
 *  maximum unknown (no SELF_INFO yet, or disconnected), only the firmware
 *  minimum is checked; callers that are about to push to the radio refuse an
 *  unknown maximum themselves. */
export function validateTxPower(dbm: number, limits: RadioLimits): Checked<number> {
  if (!Number.isInteger(dbm)) return { ok: false, error: 'TX power must be a whole number of dBm' };
  if (dbm < limits.minTxPowerDbm) {
    return { ok: false, error: `TX power must be at least ${limits.minTxPowerDbm} dBm` };
  }
  if (limits.maxTxPowerDbm !== null && dbm > limits.maxTxPowerDbm) {
    return { ok: false, error: `TX power must be at most ${limits.maxTxPowerDbm} dBm on this radio` };
  }
  return { ok: true, value: dbm };
}
