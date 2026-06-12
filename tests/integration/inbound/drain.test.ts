import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

// PUSH_MSG_WAITING (0x83) tickles the inbox pump; RESP_NO_MORE_MESSAGES (0x0a)
// ends a drain round. The pump answers each queue event with exactly one
// CMD_GET_NEXT_MSG (0x0a) and chains until the device says no-more.
const MSG_WAITING = Buffer.from([0x83]);
const NO_MORE = Buffer.from([0x0a]);
const GET_NEXT = '0a';
const DRAIN_INTERVAL_MS = 250;

const hex = (f: Buffer) => f.toString('hex');

describe('inbox drain pump', () => {
  afterEach(() => {
    protocolSession().stop();
    vi.useRealTimers();
  });

  it('pumps one GET_NEXT_MSG per queue event, coalescing + chaining to NO_MORE', async () => {
    vi.useFakeTimers();
    const fake = new FakeTransport();
    transportManager.setTransport(fake);
    protocolSession().start();

    // One MSG_WAITING → one GET_NEXT after the drain interval.
    emit.packet(companionPacket(MSG_WAITING));
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS + 10);
    expect(fake.sent.map(hex)).toEqual([GET_NEXT]);

    // A MSG_WAITING arriving mid-drain coalesces into a single pending drain —
    // no extra write while the current round is still open.
    emit.packet(companionPacket(MSG_WAITING));
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS + 10);
    expect(fake.sent).toHaveLength(1);

    // NO_MORE clears the busy flag AND fires the pending drain → a second GET_NEXT.
    emit.packet(companionPacket(NO_MORE));
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS + 10);
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent.every((f) => hex(f) === GET_NEXT)).toBe(true);

    // A final NO_MORE with nothing pending issues no further writes.
    emit.packet(companionPacket(NO_MORE));
    await vi.advanceTimersByTimeAsync(DRAIN_INTERVAL_MS + 10);
    expect(fake.sent).toHaveLength(2);
  });
});
