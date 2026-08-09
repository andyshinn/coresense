import { render } from '@testing-library/react';
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '@/components/messageListItems';
import type { Message } from '../../src/shared/types';

// A recording stand-in for VirtuosoMessageList.
//
// The real list needs layout to do anything, so jsdom can never exercise it —
// which is why MessageList had no coverage at all, despite owning the scroll
// behaviour three separate bug reports were about. This fake keeps a real item
// array (so `data.get()` and `findIndex` behave) and records every imperative
// call, which is exactly the surface MessageList drives.
interface Op {
  name: string;
  args: unknown[];
}

const ops: Op[] = [];
let items: Item[] = [];

function record(name: string, ...args: unknown[]) {
  ops.push({ name, args });
}

/** The scroll policy MessageList passed to the most recent append, evaluated
 *  against a synthetic callback parameter set. */
function appendPolicy(params: { atBottom: boolean; scrollInProgress: boolean }) {
  const call = [...ops].reverse().find((o) => o.name === 'append');
  const policy = call?.args[1];
  return typeof policy === 'function' ? (policy as (p: unknown) => unknown)(params) : policy;
}

const lastOp = (name: string) => [...ops].reverse().find((o) => o.name === name);

vi.mock('@virtuoso.dev/message-list', () => {
  const data = {
    replace: (next: Item[], opts?: unknown) => {
      items = [...next];
      record('replace', next, opts);
    },
    append: (next: Item[], policy?: unknown) => {
      items = [...items, ...next];
      record('append', next, policy);
    },
    prepend: (next: Item[]) => {
      items = [...next, ...items];
      record('prepend', next);
    },
    map: (fn: (i: Item, idx: number) => Item, behavior?: unknown) => {
      items = items.map(fn);
      record('map', behavior);
    },
    insert: (next: Item[], offset: number) => {
      items = [...items.slice(0, offset), ...next, ...items.slice(offset)];
      record('insert', next, offset);
    },
    findAndDelete: (pred: (i: Item, idx: number) => boolean) => {
      items = items.filter((i, idx) => !pred(i, idx));
      record('findAndDelete');
    },
    findIndex: (pred: (i: Item, idx: number, all: Item[]) => boolean) => items.findIndex(pred),
    batch: (cb: () => void) => {
      record('batch');
      cb();
    },
    get: () => [...items],
    getCurrentlyRendered: () => [...items],
  };

  return {
    VirtuosoMessageListLicense: ({ children }: { children: React.ReactNode }) => children,
    VirtuosoMessageList: ({
      ref,
      initialData,
      initialLocation,
      onRenderedDataChange,
    }: {
      ref?: { current: unknown };
      initialData?: Item[];
      initialLocation?: unknown;
      onRenderedDataChange?: (range: Item[]) => void;
    }) => {
      const first = React.useRef(true);
      if (first.current) {
        first.current = false;
        items = [...(initialData ?? [])];
        record('mount', initialLocation);
      }
      // React attaches a ref during commit and NULLS IT ON UNMOUNT. The list is
      // unmounted whenever the conversation is empty, and MessageList's sync
      // effect branches on exactly that, so the harness has to reproduce it.
      React.useLayoutEffect(() => {
        if (!ref) return;
        ref.current = { data, scrollToItem: (loc: unknown) => record('scrollToItem', loc) };
        return () => {
          ref.current = null;
        };
      });
      // The real list reports its rendered range after layout, which is what
      // drives mark-read. Without it lastMarkedRead never advances and the
      // focus-edge divider has no boundary to point at.
      React.useEffect(() => {
        onRenderedDataChange?.([...items]);
      });
      return null;
    },
    scrollToBottomAlways: () => 'ALWAYS',
    scrollToBottomIfAtBottom: ({ atBottom, scrollInProgress }: { atBottom: boolean; scrollInProgress: boolean }) =>
      atBottom || scrollInProgress ? 'smooth' : false,
  };
});

const { MessageList } = await import('@/components/MessageList');
const { useStore } = await import('@/lib/store');

const T0 = new Date('2026-07-25T12:00:00').getTime();

const from = (id: string, over: Partial<Message> = {}): Message => ({
  id,
  key: 'ch:x',
  body: id,
  ts: T0 + Number(id.replace(/\D/g, '')) * 1000,
  state: 'received',
  fromPublicKeyHex: 'alicepk',
  ...over,
});

const mine = (id: string): Message => {
  const m = from(id);
  delete (m as { fromPublicKeyHex?: string }).fromPublicKeyHex;
  return { ...m, state: 'sent' };
};

function view(over: Partial<React.ComponentProps<typeof MessageList>> = {}) {
  return (
    <MessageList
      conversationKey="ch:x"
      messages={[from('m1')]}
      owner={null}
      contacts={[]}
      selectedId={null}
      onSelect={() => {}}
      style="rich"
      lastReadMs={0}
      onMarkRead={() => {}}
      client={null}
      {...over}
    />
  );
}

beforeEach(() => {
  ops.length = 0;
  items = [];
  useStore.setState({ windowFocused: true });
});

describe('MessageList data sync', () => {
  it('appends only the new message on tail growth', () => {
    const msgs = [from('m1'), from('m2')];
    const { rerender } = render(view({ messages: msgs }));
    ops.length = 0;
    rerender(view({ messages: [...msgs, from('m3')] }));

    expect(lastOp('replace')).toBeUndefined();
    const append = lastOp('append');
    expect(append).toBeDefined();
    expect((append as Op).args[0] as Item[]).toHaveLength(1);
  });

  // A scrolled-up user must still see their own message land; someone else's
  // must not yank them away from what they were reading.
  it('force-scrolls for our own send but not for a remote arrival', () => {
    const msgs = [from('m1')];
    const { rerender } = render(view({ messages: msgs }));

    rerender(view({ messages: [...msgs, mine('m2')] }));
    expect(appendPolicy({ atBottom: false, scrollInProgress: false })).toBe('ALWAYS');

    rerender(view({ messages: [...msgs, mine('m2'), from('m3')] }));
    expect(appendPolicy({ atBottom: false, scrollInProgress: false })).toBe(false);
    expect(appendPolicy({ atBottom: true, scrollInProgress: false })).toBe('smooth');
  });

  // map() with no behaviour leaves the library's displacement handling off, so
  // a row that GROWS (a received message picking up its first path) silently
  // pushes content below the fold.
  it('passes a scroll behaviour when updating rows in place', () => {
    const msgs = [from('m1'), from('m2')];
    const { rerender } = render(view({ messages: msgs }));
    ops.length = 0;
    rerender(view({ messages: [msgs[0], { ...msgs[1], state: 'ack' }] }));

    expect(lastOp('map')?.args[0]).toBe('auto');
  });

  // The list only mounts once there is something to show, so an instance whose
  // first render was empty keeps an empty one-shot seed forever. If the sync
  // effect skips its bookkeeping while unmounted, coming back to a conversation
  // it already recorded looks like "nothing changed" and the remounted list is
  // never populated.
  it('repopulates a conversation revisited after an empty one', () => {
    const a = [from('m1'), from('m2')];
    // First render has no cache — this is what freezes the empty seed.
    const { rerender } = render(view({ conversationKey: 'ch:a', messages: [] }));
    rerender(view({ conversationKey: 'ch:a', messages: a }));
    expect(items.filter((i) => i.kind === 'msg')).toHaveLength(2);

    // An empty conversation unmounts the list entirely.
    rerender(view({ conversationKey: 'ch:b', messages: [] }));
    // ...and back.
    rerender(view({ conversationKey: 'ch:a', messages: a }));
    expect(items.filter((i) => i.kind === 'msg')).toHaveLength(2);
  });

  // jumpInFlightRef suppresses the remote-arrival autoscroll so an incoming
  // message can't yank a jump mid-animation. Clearing it only in the flash
  // timer leaked it: switching conversation cancels that timer.
  it('restores autoscroll after a jump is cut short by a conversation switch', () => {
    const a = [from('m1'), from('m2')];
    const { rerender } = render(view({ conversationKey: 'ch:a', messages: a, jumpToId: 'm2' }));
    // Switch away mid-flash, then take a normal arrival elsewhere.
    const b = [from('m5')];
    rerender(view({ conversationKey: 'ch:b', messages: b }));
    rerender(view({ conversationKey: 'ch:b', messages: [...b, from('m6')] }));

    expect(appendPolicy({ atBottom: true, scrollInProgress: false })).toBe('smooth');
  });

  it('carries a landing location on every wholesale replace', () => {
    const { rerender } = render(view({ messages: [from('m1')] }));
    rerender(view({ conversationKey: 'ch:y', messages: [from('m7'), from('m8')] }));

    const opts = lastOp('replace')?.args[1] as { initialLocation?: unknown };
    expect(opts?.initialLocation).toEqual({ index: 'LAST', align: 'end' });
  });
});

describe('MessageList jump-to-message', () => {
  it('rides the replace rather than racing it with a scrollToItem', () => {
    const msgs = [from('m1'), from('m2'), from('m3')];
    render(view({ conversationKey: 'ch:x', messages: msgs, jumpToId: 'm2' }));

    // Mount seeds initialData/initialLocation rather than calling replace.
    expect(lastOp('mount')?.args[0]).toEqual({ index: 1, align: 'start-no-overflow' });
    expect(lastOp('scrollToItem')).toBeUndefined();
  });

  it('scrolls imperatively when there is no data operation to ride', () => {
    const msgs = [from('m1'), from('m2'), from('m3')];
    const { rerender } = render(view({ messages: msgs }));
    ops.length = 0;
    rerender(view({ messages: msgs, jumpToId: 'm3' }));

    expect(lastOp('scrollToItem')?.args[0]).toMatchObject({ index: 2, align: 'start-no-overflow' });
  });

  // 'center' and 'end' throw for an index the library has not measured, and the
  // error is swallowed — the scroll just never happens.
  it('never asks for an align that throws on an unmeasured index', () => {
    const msgs = [from('m1'), from('m2')];
    render(view({ messages: msgs, jumpToId: 'm2' }));
    const loc = lastOp('mount')?.args[0] as { align?: string };
    expect(loc.align).toBe('start-no-overflow');
  });

  it('consumes the jump once the target is on screen', () => {
    const onJumpConsumed = vi.fn();
    render(view({ messages: [from('m1'), from('m2')], jumpToId: 'm2', onJumpConsumed }));
    expect(onJumpConsumed).toHaveBeenCalledTimes(1);
  });

  // The parent clears jumpToId in response, but not before the effect can run
  // again — StrictMode replays it on mount, and the effect reads a ref mirror,
  // so the stale id is still visible on that second pass.
  it('does not deliver the same jump twice when the effect replays', () => {
    const onJumpConsumed = vi.fn();
    const msgs = [from('m1'), from('m2')];
    const { rerender } = render(view({ messages: msgs, jumpToId: 'm2', onJumpConsumed }));
    // Parent re-renders without having cleared the jump yet.
    rerender(view({ messages: msgs, jumpToId: 'm2', onJumpConsumed, selectedId: 'm1' }));
    expect(onJumpConsumed).toHaveBeenCalledTimes(1);
  });

  // The target may be older than the loaded window. Consuming it there would
  // discard the request before the backfill could satisfy it.
  it('leaves the jump pending when the target is not loaded', () => {
    const onJumpConsumed = vi.fn();
    const { rerender } = render(view({ messages: [from('m1')] }));
    rerender(view({ messages: [from('m1')], jumpToId: 'm99', onJumpConsumed }));
    expect(onJumpConsumed).not.toHaveBeenCalled();
  });

  it('lands the jump once a later batch brings the target in', () => {
    const onJumpConsumed = vi.fn();
    const { rerender } = render(view({ messages: [from('m5')] }));
    rerender(view({ messages: [from('m5')], jumpToId: 'm1', onJumpConsumed }));
    expect(onJumpConsumed).not.toHaveBeenCalled();

    // The backfill window splices older history in front.
    rerender(view({ messages: [from('m1'), from('m2'), from('m5')], jumpToId: 'm1', onJumpConsumed }));
    expect(onJumpConsumed).toHaveBeenCalledTimes(1);
  });
});

describe('MessageList unread divider on refocus', () => {
  const blurAndReturn = (rerender: (ui: React.ReactElement) => void, ui: React.ReactElement, after: React.ReactElement) => {
    act(() => {
      useStore.setState({ windowFocused: false });
    });
    rerender(ui);
    rerender(after);
    act(() => {
      useStore.setState({ windowFocused: true });
    });
  };

  it('plants a New marker at the boundary of what arrived while away', () => {
    const msgs = [from('m1'), from('m2')];
    const { rerender } = render(view({ messages: msgs }));
    ops.length = 0;

    blurAndReturn(rerender, view({ messages: msgs }), view({ messages: [...msgs, from('m3'), from('m4')] }));

    expect(lastOp('insert')).toBeDefined();
    expect(items.filter((i) => i.kind === 'divider')).toHaveLength(1);
    const dividerIdx = items.findIndex((i) => i.kind === 'divider');
    const next = items[dividerIdx + 1];
    expect(next.kind === 'msg' && next.m.id).toBe('m3');
  });

  it('plants no marker when nothing arrived while away', () => {
    const msgs = [from('m1'), from('m2')];
    const { rerender } = render(view({ messages: msgs }));
    ops.length = 0;

    blurAndReturn(rerender, view({ messages: msgs }), view({ messages: msgs }));

    expect(lastOp('insert')).toBeUndefined();
    expect(items.some((i) => i.kind === 'divider')).toBe(false);
  });

  it('replaces the previous marker rather than stacking a second one', () => {
    const msgs = [from('m1')];
    const { rerender } = render(view({ messages: msgs }));
    const round1 = [...msgs, from('m2')];
    blurAndReturn(rerender, view({ messages: msgs }), view({ messages: round1 }));
    blurAndReturn(rerender, view({ messages: round1 }), view({ messages: [...round1, from('m3')] }));

    expect(items.filter((i) => i.kind === 'divider')).toHaveLength(1);
  });

  // Mark-read is focus-gated, so nothing should be reported read while away.
  it('reports nothing read while the window is in the background', () => {
    const onMarkRead = vi.fn();
    const msgs = [from('m1')];
    const { rerender } = render(view({ messages: msgs, onMarkRead }));
    onMarkRead.mockClear();

    act(() => {
      useStore.setState({ windowFocused: false });
    });
    rerender(view({ messages: [...msgs, from('m2')], onMarkRead }));
    expect(onMarkRead).not.toHaveBeenCalled();
  });
});
