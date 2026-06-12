import { Buffer } from 'node:buffer';
import { child } from '../../log';
import { transportManager } from '../../transport/manager';
import { CMD, PUSH, RESP } from '../codes';
import type { Feature, FeatureContext } from '../feature';

const log = child('protocol');

// Backoff on the inbox-pump. The bridge's InboxRouter already serialises 0x0a
// across proxy clients; we issue our own 0x0a but pace ourselves so we don't
// starve concurrent phones.
const DRAIN_INTERVAL_MS = 250;

// CMD_GET_NEXT_MSG drains the device's inbox queue by one. Replied to with
// RESP_CONTACT_MSG_RECV(_V3) / RESP_CHANNEL_MSG_RECV(_V3) / RESP_NO_MORE_MESSAGES.
export function encodeGetNextMsg(): Buffer {
  return Buffer.from([CMD.GET_NEXT_MSG]);
}

// The firmware sends ONE PUSH_MSG_WAITING per queue event, so we chain
// GET_NEXT_MSG ourselves after every *_MSG_RECV until the device replies with
// NO_MORE_MESSAGES. `drainBusy` is cleared only on NO_MORE_MESSAGES (see
// drainFeature) — not after writeFrame returns — so the pump doesn't
// oversubscribe the radio.
let drainBusy = false;
let drainPending = false;

function isConnected(): boolean {
  return transportManager.getState().state === 'connected';
}

/** True while a drain round is active. Message handlers gate their follow-up
 *  pump on this (`if (isDraining()) pumpAfterRecv(ctx)`). */
export function isDraining(): boolean {
  return drainBusy;
}

/** Kick a drain round. If one is already active, mark a pending round so a
 *  single follow-up fires once the current round ends. */
export async function scheduleDrain(ctx: FeatureContext): Promise<void> {
  if (drainBusy) {
    drainPending = true;
    return;
  }
  drainBusy = true;
  await sleep(DRAIN_INTERVAL_MS);
  try {
    await ctx.writeFrame(encodeGetNextMsg());
  } catch (err) {
    log.warn(`drain write failed: ${(err as Error).message}`);
    drainBusy = false;
    // No reply will come, so re-arm if another PUSH_MSG_WAITING raced in.
    if (drainPending) {
      drainPending = false;
      void scheduleDrain(ctx);
    }
  }
}

/** Called from the message handlers after a drain returned a message. Issues
 *  the next GET_NEXT_MSG immediately so we keep draining until the device says
 *  NO_MORE_MESSAGES. */
export function pumpAfterRecv(ctx: FeatureContext): void {
  if (!isConnected()) return;
  ctx.writeFrame(encodeGetNextMsg()).catch((err) => {
    log.warn(`drain pump write failed: ${(err as Error).message}`);
    drainBusy = false;
  });
}

/** Clear pump state on disconnect so a reconnect starts a fresh drain cycle. */
export function resetDrain(): void {
  drainBusy = false;
  drainPending = false;
}

export const drainFeature: Feature = {
  handles: [PUSH.MSG_WAITING, RESP.NO_MORE_MESSAGES],
  handle: (code, _frame, ctx) => {
    if (code === PUSH.MSG_WAITING) {
      void scheduleDrain(ctx);
      return;
    }
    // RESP.NO_MORE_MESSAGES — the drain round is complete.
    drainBusy = false;
    log.trace('drain done: NO_MORE_MESSAGES');
    if (drainPending) {
      drainPending = false;
      void scheduleDrain(ctx);
    }
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
