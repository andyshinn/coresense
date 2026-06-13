import { Buffer } from 'node:buffer';
import type { Contact, Message } from '../../../shared/types';
import { bus, emit } from '../../events/bus';
import { child } from '../../log';
import { stateHolder } from '../../state/holder';
import { CMD, PUSH, RESP, TXT_TYPE } from '../codes';
import type { Feature, FeatureContext } from '../feature';
import { encodeResetPath } from './contacts';
import { isDraining, pumpAfterRecv } from './drain';

const log = child('protocol');

// After RESP_SENT lands we hold the expected_ack hash → message id mapping
// until a PUSH_SEND_CONFIRMED arrives (or until ACK_RETENTION_MS).
const ACK_RETENTION_MS = 60_000;
// Per-attempt wait inside sendDmTextWithRetry. The radio's RESP_SENT carries
// an `est_timeout` we could read here, but the worst-case for a multi-hop flood
// is bounded by retention not link speed — pick a value generous enough for a
// 3-hop round-trip but short enough that 3+2 attempts don't take all day.
const PER_ATTEMPT_TIMEOUT_MS = 30_000;

// ---- Encoder -----------------------------------------------------------

// CMD_SEND_TXT_MSG payload (firmware: companion_radio/MyMesh.cpp):
//   [0x02][txt_type 1B][attempt 1B][ts 4B LE][dest pubkey prefix 6B][text UTF-8...]
// The firmware looks the recipient up by the first 6 bytes of their public key
// (contacts the device has learned from adverts). Pass the full pubkey hex; we
// take the first 6 bytes ourselves so callers don't have to slice.
export function encodeSendDmText(opts: {
  destPublicKeyHex: string;
  text: string;
  txtType?: number;
  attempt?: number;
  timestampUnix?: number;
}): Buffer {
  const pubkey = Buffer.from(opts.destPublicKeyHex, 'hex');
  if (pubkey.length < 6) {
    throw new Error(`dest public key must be ≥6 bytes, got ${pubkey.length}`);
  }
  const text = Buffer.from(opts.text, 'utf8');
  const ts = opts.timestampUnix ?? Math.floor(Date.now() / 1000);
  const out = Buffer.alloc(13 + text.length);
  out[0] = CMD.SEND_TXT_MSG;
  out[1] = opts.txtType ?? TXT_TYPE.PLAIN;
  out[2] = opts.attempt ?? 0;
  out.writeUInt32LE(ts >>> 0, 3);
  pubkey.copy(out, 7, 0, 6);
  text.copy(out, 13);
  return out;
}

// ---- Decoders ----------------------------------------------------------

// RESP_CONTACT_MSG_RECV_V3 frame (firmware: companion_radio/MyMesh.cpp):
//   [0]: 0x10
//   [1]: snr*4 (signed int8) — divide by 4 for dB
//   [2..3]: 2B reserved
//   [4..9]: 6B sender public-key prefix
//   [10]: path_len (0xFF = direct/no flood)
//   [11]: txt_type
//   [12..15]: timestamp uint32 LE (UNIX seconds)
//   [16..]: text body (no "name: " prefix — sender identified by pubkey prefix)
export interface ContactMsgV3 {
  snrDb: number;
  senderPubKeyPrefixHex: string;
  pathLen: number;
  txtType: number;
  timestampUnix: number;
  body: string;
}

export function decodeContactMsgV3(frame: Buffer): ContactMsgV3 | null {
  if (frame.length < 16) return null;
  const snrRaw = frame.readInt8(1);
  const senderPubKeyPrefixHex = frame.subarray(4, 10).toString('hex');
  const pathLen = frame[10];
  const txtType = frame[11];
  const timestampUnix = frame.readUInt32LE(12);
  const body = frame.subarray(16).toString('utf8').replace(/\0+$/, '');
  return {
    snrDb: snrRaw / 4,
    senderPubKeyPrefixHex,
    pathLen,
    txtType,
    timestampUnix,
    body,
  };
}

// Older RESP_CONTACT_MSG_RECV (0x07) — pre-V3, no SNR prefix.
//   [0]: 0x07
//   [1..6]: 6B sender pub_key_prefix
//   [7]: path_len
//   [8]: txt_type
//   [9..12]: timestamp uint32 LE
//   [13..]: text body
export function decodeContactMsgV1(frame: Buffer): ContactMsgV3 | null {
  if (frame.length < 13) return null;
  const senderPubKeyPrefixHex = frame.subarray(1, 7).toString('hex');
  const pathLen = frame[7];
  const txtType = frame[8];
  const timestampUnix = frame.readUInt32LE(9);
  const body = frame.subarray(13).toString('utf8').replace(/\0+$/, '');
  return { snrDb: 0, senderPubKeyPrefixHex, pathLen, txtType, timestampUnix, body };
}

// RESP_SENT (0x06) acknowledging a CMD_SEND_TXT_MSG / CMD_SEND_CHAN_TXT_MSG:
//   [0]: 0x06
//   [1]: flood_flag (1 = flood, 0 = direct)
//   [2..5]: expected_ack uint32 LE (0 = no ACK expected)
//   [6..9]: est_timeout milliseconds uint32 LE
export interface SentAck {
  flood: boolean;
  expectedAckHex: string;
  estTimeoutMs: number;
}

export function decodeSentAck(frame: Buffer): SentAck | null {
  if (frame.length < 10) return null;
  return {
    flood: frame[1] === 1,
    expectedAckHex: frame.subarray(2, 6).toString('hex'),
    estTimeoutMs: frame.readUInt32LE(6),
  };
}

// PUSH_SEND_CONFIRMED (0x82) fires when an ACK matching a prior expected_ack
// arrives from the recipient.
//   [0]: 0x82
//   [1..4]: ack_hash uint32 LE
//   [5..8]: trip_time_millis uint32 LE
export interface SendConfirmed {
  ackHex: string;
  tripTimeMs: number;
}

export function decodeSendConfirmed(frame: Buffer): SendConfirmed | null {
  if (frame.length < 9) return null;
  return {
    ackHex: frame.subarray(1, 5).toString('hex'),
    tripTimeMs: frame.readUInt32LE(5),
  };
}

// ---- Send state machine ------------------------------------------------

// DM send → RESP_SENT has no correlation id, so we FIFO outgoing DMs and pop on
// each RESP_SENT.
const dmSendQueue: string[] = [];
// expected_ack hex → message id, populated on RESP_SENT and cleared on
// PUSH_SEND_CONFIRMED or after ACK_RETENTION_MS.
const pendingDmAcks = new Map<string, { messageId: string; timer: NodeJS.Timeout }>();

// Repeater-admin (Phase 2f) shares the RESP_SENT / CONTACT_MSG_RECV opcodes:
// admin sends are ack'd ahead of DMs, and txt_type=CLI_DATA replies route to a
// pending CLI awaiter. Those queues live in ProtocolSession (Phase 2f); it
// registers these hooks so admin keeps first crack. A hook returns true when it
// consumed the frame.
let adminHooks: {
  onSentTag?: (expectedAckHex: string) => boolean;
  onCliReply?: (senderPrefixHex: string, body: string) => boolean;
} = {};

export function setAdminHooks(hooks: {
  onSentTag?: (expectedAckHex: string) => boolean;
  onCliReply?: (senderPrefixHex: string, body: string) => boolean;
}): void {
  adminHooks = hooks;
}

/** Push a message id onto the DM send FIFO. Exported for the admin CLI send
 *  path (still in ProtocolSession), whose sends are DMs at the wire level. */
export function enqueueDmSend(id: string): void {
  dmSendQueue.push(id);
}

/** Remove a message id from the DM send FIFO (on write failure). */
export function dequeueDmSend(id: string): void {
  const i = dmSendQueue.indexOf(id);
  if (i !== -1) dmSendQueue.splice(i, 1);
}

/** Send a DM to a contact. Returns ok on transport-level write success; the
 *  message state machine continues asynchronously: RESP_SENT flips 'sending'
 *  → 'sent', PUSH_SEND_CONFIRMED flips 'sent' → 'ack'. */
export async function sendDmText(
  ctx: FeatureContext,
  contactKey: string,
  text: string,
  messageId: string,
  opts: { attempt?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const contact = stateHolder()
    .getContacts()
    .find((c) => c.key === contactKey);
  if (!contact) return { ok: false, error: `unknown contact ${contactKey}` };
  if (!contact.publicKeyHex || contact.publicKeyHex.length < 12) {
    return { ok: false, error: `contact ${contactKey} has no usable public key` };
  }

  const frame = encodeSendDmText({
    destPublicKeyHex: contact.publicKeyHex,
    text,
    attempt: opts.attempt,
  });
  dmSendQueue.push(messageId);
  try {
    await ctx.writeFrame(frame);
    return { ok: true };
  } catch (err) {
    // The radio won't reply with RESP_SENT, so pop the entry to keep the
    // FIFO aligned with the next successful write.
    dequeueDmSend(messageId);
    return { ok: false, error: (err as Error).message };
  }
}

/** Send a DM with retry + flood fallback, mirroring the official client's
 *  behavior. If the contact has a known out_path: 3 attempts using the path,
 *  then 2 more after a CMD_RESET_PATH so the radio floods. If no path is
 *  known: 3 flood attempts straight away. When a flood attempt succeeds and
 *  the radio (via the next advert) hands us a different out_path, emit a
 *  `pathLearned` event so the renderer can prompt-or-toast. */
export async function sendDmTextWithRetry(
  ctx: FeatureContext,
  contactKey: string,
  text: string,
  messageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const holder = stateHolder();
  const initial = holder.getContacts().find((c) => c.key === contactKey);
  if (!initial) return { ok: false, error: `unknown contact ${contactKey}` };
  if (!initial.publicKeyHex || initial.publicKeyHex.length < 64) {
    return { ok: false, error: `contact ${contactKey} has no full 32B public key` };
  }
  const initialPathHex = initial.outPathHex ?? '';
  const initialManual = initial.pathManual === true;
  const hadPath = initialPathHex.length > 0;
  const knownAttempts = hadPath ? 3 : 0;
  const floodAttempts = hadPath ? 2 : 3;

  let attempt = 0;
  // Phase 1: try the known path.
  for (let i = 0; i < knownAttempts; i += 1) {
    const r = await sendDmText(ctx, contactKey, text, messageId, { attempt });
    attempt += 1;
    if (!r.ok) continue;
    if ((await awaitDmOutcome(messageId, PER_ATTEMPT_TIMEOUT_MS)) === 'ack') {
      return { ok: true };
    }
  }

  // Phase 2: drop the path on the radio, then flood.
  if (hadPath && floodAttempts > 0) {
    try {
      await ctx.writeFrame(encodeResetPath(initial.publicKeyHex));
      holder.upsertContact({
        ...initial,
        outPathHex: undefined,
        hops: undefined,
        pathManual: false,
      });
      emit.contacts(holder.getContacts());
    } catch (err) {
      log.warn(`resetContactPath during retry failed: ${(err as Error).message}`);
    }
  }
  for (let i = 0; i < floodAttempts; i += 1) {
    const r = await sendDmText(ctx, contactKey, text, messageId, { attempt });
    attempt += 1;
    if (!r.ok) continue;
    if ((await awaitDmOutcome(messageId, PER_ATTEMPT_TIMEOUT_MS)) === 'ack') {
      const post = holder.getContacts().find((c) => c.key === contactKey);
      const newPath = post?.outPathHex ?? '';
      if (newPath && newPath !== initialPathHex) {
        emit.pathLearned({
          contactKey,
          newOutPathHex: newPath,
          newOutPathHashSize: post?.outPathHashSize ?? holder.getRadioSettings().pathHashMode,
          previousOutPathHex: initialPathHex,
          previousManual: initialManual,
          learnedAt: Date.now(),
        });
      }
      return { ok: true };
    }
  }

  // All attempts timed out — surface as 'failed' for the UI.
  holder.setMessageState(messageId, 'failed');
  emit.messageState(messageId, 'failed');
  return { ok: false, error: 'all retry attempts failed' };
}

/** Resolve when `messageId` reaches a terminal state ('ack' or 'failed'),
 *  or when `timeoutMs` elapses. Used by sendDmTextWithRetry to know when an
 *  attempt has succeeded vs. when to retry. */
function awaitDmOutcome(messageId: string, timeoutMs: number): Promise<'ack' | 'timeout'> {
  return new Promise((resolve) => {
    const handler = (id: string, state: string) => {
      if (id !== messageId) return;
      if (state === 'ack') {
        cleanup();
        resolve('ack');
      } else if (state === 'failed') {
        cleanup();
        resolve('timeout');
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve('timeout');
    }, timeoutMs);
    const cleanup = () => {
      bus.off('messageState', handler);
      clearTimeout(timer);
    };
    bus.on('messageState', handler);
  });
}

/** Fail the oldest in-flight DM (bare RESP_ERR, or disconnect). */
export function failOldestDmSend(reason: string): void {
  const messageId = dmSendQueue.shift();
  if (!messageId) return;
  stateHolder().setMessageState(messageId, 'failed');
  emit.messageState(messageId, 'failed');
  log.warn(`dm failed id=${messageId}: ${reason}`);
}

/** Tear down the DM send/ack state on disconnect so callers don't hang. */
export function resetDmState(reason: string): void {
  while (dmSendQueue.length > 0) failOldestDmSend(reason);
  for (const entry of pendingDmAcks.values()) clearTimeout(entry.timer);
  pendingDmAcks.clear();
}

// ---- Inbound handlers --------------------------------------------------

function handleContactMsg(code: number, frame: Buffer, ctx: FeatureContext): void {
  const parsed = code === RESP.CONTACT_MSG_RECV_V3 ? decodeContactMsgV3(frame) : decodeContactMsgV1(frame);
  if (!parsed) return;
  // CLI replies arrive on the same opcode as DMs; route them to the matching
  // admin awaiter (Phase 2f) and don't insert them into the message store.
  if (parsed.txtType === TXT_TYPE.CLI_DATA) {
    if (adminHooks.onCliReply?.(parsed.senderPubKeyPrefixHex.toLowerCase(), parsed.body)) {
      if (isDraining()) pumpAfterRecv(ctx);
      return;
    }
  }

  const holder = stateHolder();
  const prefix = parsed.senderPubKeyPrefixHex;
  let contact = holder.getContacts().find((c) => c.publicKeyHex.toLowerCase().startsWith(prefix.toLowerCase()));

  if (!contact) {
    // Unknown sender — synth a placeholder contact keyed by the 6-byte
    // prefix. A future advert handler (Phase 7+) will reconcile this when
    // the full pubkey + display name arrive.
    contact = {
      key: `c:${prefix}`,
      publicKeyHex: prefix,
      name: `(${prefix})`,
      kind: 'chat',
    } satisfies Contact;
    holder.upsertContact(contact);
    emit.contacts(holder.getContacts());
    log.debug(`synth contact for unknown sender prefix=${prefix}`);
  }

  const message: Message = {
    id: `radio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    key: contact.key,
    ts: parsed.timestampUnix * 1000,
    fromPublicKeyHex: contact.publicKeyHex,
    body: parsed.body,
    state: 'received',
    meta: { snr: parsed.snrDb },
  };
  holder.insertMessage(message);
  emit.messages(contact.key, holder.getMessagesForKey(contact.key));
  log.debug(`contact msg from=${prefix} → "${contact.name}" body=${JSON.stringify(parsed.body.slice(0, 60))}`);
  // The radio only tickles PUSH_MSG_WAITING once per queue event; keep
  // pulling until NO_MORE_MESSAGES.
  if (isDraining()) pumpAfterRecv(ctx);
}

function handleSent(frame: Buffer): void {
  const sent = decodeSentAck(frame);
  if (!sent) return;
  // Admin writes are serialised and ack'd ahead of DM sends. The expected_ack
  // u32 from RESP_SENT is the same `tag` the firmware later echoes back in
  // PUSH_BINARY_RESPONSE / PUSH_LOGIN_SUCCESS.
  if (adminHooks.onSentTag?.(sent.expectedAckHex)) return;
  const messageId = dmSendQueue.shift();
  if (!messageId) {
    // RESP_SENT for a non-DM (e.g. channel send echo) — no state machine.
    return;
  }
  const holder = stateHolder();
  holder.setMessageState(messageId, 'sent');
  emit.messageState(messageId, 'sent');
  log.debug(`dm sent id=${messageId} flood=${sent.flood} ack=${sent.expectedAckHex} timeout=${sent.estTimeoutMs}ms`);

  if (sent.expectedAckHex !== '00000000') {
    const timer = setTimeout(() => {
      pendingDmAcks.delete(sent.expectedAckHex);
    }, ACK_RETENTION_MS);
    pendingDmAcks.set(sent.expectedAckHex, { messageId, timer });
  }
}

function handleSendConfirmed(frame: Buffer): void {
  const conf = decodeSendConfirmed(frame);
  if (!conf) return;
  const entry = pendingDmAcks.get(conf.ackHex);
  if (!entry) return;
  clearTimeout(entry.timer);
  pendingDmAcks.delete(conf.ackHex);
  stateHolder().setMessageState(entry.messageId, 'ack');
  emit.messageState(entry.messageId, 'ack');
  log.debug(`dm ack id=${entry.messageId} ack=${conf.ackHex} rtt=${conf.tripTimeMs}ms`);
}

export const directMessagesFeature: Feature = {
  handles: [RESP.CONTACT_MSG_RECV_V3, RESP.CONTACT_MSG_RECV, RESP.SENT, PUSH.SEND_CONFIRMED],
  handle: (code, frame, ctx) => {
    if (code === RESP.SENT) {
      handleSent(frame);
      return;
    }
    if (code === PUSH.SEND_CONFIRMED) {
      handleSendConfirmed(frame);
      return;
    }
    handleContactMsg(code, frame, ctx);
  },
};
