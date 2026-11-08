// The connected radio's TX power range, read passively from the frames it
// already sends.
//
// Firmware reports its board maximum (MAX_LORA_TX_POWER) in RESP_SELF_INFO
// byte 3, the reply to the handshake's CMD_APP_START. meshcore-ts parses the
// byte but neither stores nor emits it, and asking again with getSelfInfo()
// would re-send APP_START, which stops a contact walk in progress (see
// telemetry/policy.ts). So it is taken off the packet bus instead: every
// inbound companion frame passes through there for the packet log anyway.

import { DEFAULT_RADIO_LIMITS, type RadioLimits, type RawPacket } from '../../shared/types';
import { commit } from '../state/commit';
import { stateHolder } from '../state/holder';

/** RESP_CODE_SELF_INFO (companion_radio MyMesh.cpp). */
const RESP_SELF_INFO = 5;
/** Byte offset of MAX_LORA_TX_POWER in RESP_SELF_INFO. */
const MAX_TX_POWER_OFFSET = 3;

/** The board maximum a RESP_SELF_INFO frame reports, or null for any other
 *  frame. The byte is unsigned on the wire; no board reports more than 30. */
export function maxTxPowerFromFrame(bytes: readonly number[]): number | null {
  if (bytes[0] !== RESP_SELF_INFO || bytes.length <= MAX_TX_POWER_OFFSET) return null;
  return bytes[MAX_TX_POWER_OFFSET];
}

/** Fold an inbound frame into the radio limits. Broadcasts only on a change. */
export function observeRadioLimits(p: RawPacket): void {
  if (p.kind !== 'companion') return;
  const max = maxTxPowerFromFrame(p.bytes);
  if (max === null) return;
  const current = stateHolder().getRadioLimits();
  if (current.maxTxPowerDbm === max) return;
  commit.radioLimits({ ...current, maxTxPowerDbm: max });
}

/** Forget the limits: the link dropped, and the next radio may differ. */
export function clearRadioLimits(): void {
  const current: RadioLimits = stateHolder().getRadioLimits();
  if (current.maxTxPowerDbm === null) return;
  commit.radioLimits({ ...DEFAULT_RADIO_LIMITS });
}
