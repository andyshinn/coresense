import { describe, expect, it, vi } from 'vitest';
import { createSender } from '../../../src/main/messaging/sendMessage';

function harness(over: { channelOk?: boolean; channelHash?: number } = {}) {
  const inserted: unknown[] = [];
  const states: Array<{ id: string; state: string }> = [];
  const registered: unknown[] = [];
  const session = {
    sendChannelText: vi.fn(async () => ({ ok: over.channelOk ?? true, channelHash: over.channelHash })),
    sendDmTextWithRetry: vi.fn(async () => ({ ok: true })),
    registerChannelSend: vi.fn((p: unknown) => registered.push(p)),
  };
  const holder = {
    insertMessage: (m: unknown) => inserted.push(m),
    setMessageState: (id: string, state: string) => states.push({ id, state }),
    getMessagesForKey: () => inserted,
  };
  const send = createSender({
    getSession: () => session,
    getHolder: () => holder,
    emitMessages: vi.fn(),
    emitMessageState: vi.fn(),
    now: () => 1000,
    genId: () => 'local-test',
  });
  return { send, session, inserted, states, registered };
}

describe('createSender', () => {
  it('channel: inserts optimistically, sends, marks sent, registers the send', async () => {
    const h = harness({ channelOk: true, channelHash: 42 });
    const res = await h.send('ch:General', 'hi');
    expect(res).toEqual({ ok: true, id: 'local-test' });
    expect(h.inserted[0]).toMatchObject({ id: 'local-test', key: 'ch:General', body: 'hi', state: 'sending' });
    expect(h.session.sendChannelText).toHaveBeenCalledWith('ch:General', 'hi');
    expect(h.states).toContainEqual({ id: 'local-test', state: 'sent' });
    expect(h.registered).toEqual([{ messageId: 'local-test', channelHash: 42 }]);
  });

  it('channel failure marks failed and returns the error', async () => {
    const h = harness({ channelOk: false });
    const res = await h.send('ch:General', 'hi');
    expect(res.ok).toBe(false);
    expect(h.states).toContainEqual({ id: 'local-test', state: 'failed' });
  });

  it('DM: inserts optimistically and dispatches the retry send', async () => {
    const h = harness();
    const res = await h.send('c:abcd', 'yo');
    expect(res).toEqual({ ok: true, id: 'local-test' });
    expect(h.session.sendDmTextWithRetry).toHaveBeenCalledWith('c:abcd', 'yo', 'local-test');
  });

  it('DM: logs and marks failed when the background retry send rejects', async () => {
    const logError = vi.fn();
    const states: Array<{ id: string; state: string }> = [];
    const session = {
      sendChannelText: vi.fn(async () => ({ ok: true })),
      sendDmTextWithRetry: vi.fn(async () => {
        throw new Error('boom');
      }),
      registerChannelSend: vi.fn(),
    };
    const holder = {
      insertMessage: () => {},
      setMessageState: (id: string, state: string) => states.push({ id, state }),
      getMessagesForKey: () => [],
    };
    const send = createSender({
      getSession: () => session,
      getHolder: () => holder,
      emitMessages: vi.fn(),
      emitMessageState: vi.fn(),
      now: () => 1000,
      genId: () => 'local-test',
      logError,
    });
    await send('c:abcd', 'yo');
    // The .catch runs on a microtask after the fire-and-forget DM send rejects.
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toContainEqual({ id: 'local-test', state: 'failed' });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('local-test'));
  });
});
