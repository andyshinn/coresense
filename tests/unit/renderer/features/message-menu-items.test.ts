import { describe, expect, it, vi } from 'vitest';
import { buildMessageMenuItems } from '../../../../src/renderer/features/message-actions/menuItems';
import type { Message } from '../../../../src/shared/types';

const received = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  key: 'ch:x',
  body: 'hi',
  ts: 0,
  state: 'received',
  fromPublicKeyHex: 'a3f9c1d8',
  ...over,
});

const own = (over: Partial<Message> = {}): Message => ({ id: 'm2', key: 'ch:x', body: 'yo', ts: 0, state: 'sent', ...over });

const opts = {
  senderName: 'nate',
  onViewContact: vi.fn(),
  onBlock: vi.fn(),
  onDelete: vi.fn(),
};

const labels = (entries: ReturnType<typeof buildMessageMenuItems>) =>
  entries.filter((e) => e.kind !== 'separator').map((e) => (e as { label: string }).label);

describe('buildMessageMenuItems', () => {
  it('offers Delete message on a received message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: received(), isSelf: false }))).toContain('Delete message');
  });

  it('offers Delete message on your own message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: own(), isSelf: true }))).toContain('Delete message');
  });

  it('puts Delete message last and marks it dangerous', () => {
    const entries = buildMessageMenuItems({ ...opts, message: received(), isSelf: false });
    const last = entries[entries.length - 1];
    expect(last.kind !== 'separator' && last.label).toBe('Delete message');
    expect(last.kind !== 'separator' && last.danger).toBe(true);
  });

  it('calls onDelete with the message', () => {
    const onDelete = vi.fn();
    const entries = buildMessageMenuItems({ ...opts, onDelete, message: received(), isSelf: false });
    const item = entries.find((e) => e.kind !== 'separator' && e.label === 'Delete message');
    if (item?.kind === 'separator' || !item) throw new Error('no delete item');
    item.onClick();
    expect(onDelete).toHaveBeenCalledWith(received());
  });

  it('omits Block sender on your own message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: own(), isSelf: true }))).not.toContain('Block sender…');
  });

  it('offers Block sender on a received message', () => {
    expect(labels(buildMessageMenuItems({ ...opts, message: received(), isSelf: false }))).toContain('Block sender…');
  });

  it('offers the pubkey and contact items only for a real pubkey', () => {
    const named = labels(
      buildMessageMenuItems({ ...opts, message: received({ fromPublicKeyHex: 'name:nate' }), isSelf: false }),
    );
    expect(named).not.toContain('View contact');
    expect(named).not.toContain('Copy public key');
  });

  it('offers both path items when a path was heard', () => {
    const withPath = received({
      meta: {
        paths: [{ id: 'p', hashMode: 1, finalSnr: 0, hops: [{ kind: 'origin', shortId: 'a3' }] }],
      },
    });
    const got = labels(buildMessageMenuItems({ ...opts, message: withPath, isSelf: false }));
    expect(got).toContain('Copy first path heard');
    expect(got).toContain('Copy all paths heard');
  });

  it('omits the path items when no path was heard', () => {
    const got = labels(buildMessageMenuItems({ ...opts, message: received(), isSelf: false }));
    expect(got).not.toContain('Copy first path heard');
  });

  it('offers Re-send only for a failed message with a handler', () => {
    const onResend = vi.fn();
    expect(labels(buildMessageMenuItems({ ...opts, message: own({ state: 'failed' }), isSelf: true, onResend }))).toContain(
      'Re-send',
    );
    expect(labels(buildMessageMenuItems({ ...opts, message: own({ state: 'failed' }), isSelf: true }))).not.toContain(
      'Re-send',
    );
  });

  // The unification's actual deliverable is this exact sequence — one item set
  // behind both renderers, grouped by separator. The hygiene tests below use an
  // own-message input that yields a single separator and so cannot catch a
  // grouping regression; this maximal case is what pins the order.
  it('emits the full label-and-separator sequence for a maximal message', () => {
    const onResend = vi.fn();
    const maximal = received({
      state: 'failed',
      meta: {
        paths: [{ id: 'p', hashMode: 1, finalSnr: 0, hops: [{ kind: 'origin', shortId: 'a3' }] }],
      },
    });
    const entries = buildMessageMenuItems({ ...opts, message: maximal, isSelf: false, onResend });
    expect(entries.map((e) => (e.kind === 'separator' ? '---' : e.label))).toEqual([
      'Copy text',
      '---',
      'View contact',
      'Copy public key',
      'Copy first path heard',
      'Copy all paths heard',
      '---',
      'Re-send',
      'Block sender…',
      '---',
      'Delete message',
    ]);
  });

  it('never emits two adjacent separators', () => {
    const entries = buildMessageMenuItems({ ...opts, message: own(), isSelf: true });
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].kind === 'separator' && entries[i - 1].kind === 'separator').toBe(false);
    }
  });

  it('never starts or ends with a separator', () => {
    const entries = buildMessageMenuItems({ ...opts, message: own(), isSelf: true });
    expect(entries[0].kind).not.toBe('separator');
    expect(entries[entries.length - 1].kind).not.toBe('separator');
  });
});
