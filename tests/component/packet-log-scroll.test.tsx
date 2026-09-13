import { render, screen } from '@testing-library/react';
import type { ItemLocationCallback } from '@virtuoso.dev/message-list';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PacketLog } from '@/components/PacketLog';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';
import { listRecorder } from '../support/messageListRecorder';

// jsdom has no layout, so the real list can't show where it scrolled. Record where
// each mount asks to land and the follow policy instead.
//
// The previous version of this file mocked react-virtuoso's scrollToIndex and passed
// while the real list stopped near the top. That scroll ran in the mount commit and
// was clamped to the unmeasured height. These tests pin the declarative landing that
// replaced it. The landing itself was checked in headless Chromium, not here.
vi.mock('@virtuoso.dev/message-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@virtuoso.dev/message-list')>()),
  ...(await import('../support/messageListRecorder')),
}));

const NEWEST = { index: 'LAST', align: 'end' };

const pkt = (i: number): LivePacket => ({
  id: `pkt-${i}`,
  timestamp: i,
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: '0a00cbe31122aabbccdd',
  payloadBytes: [],
});

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => pkt(from + i));

beforeEach(() => {
  listRecorder.reset();
  useStore.setState({ selectedPacketId: null, packetLogView: null });
  useStore.getState().setPacketLogFilter({ source: 'both' });
});

describe('PacketLog scroll-to-newest', () => {
  it('lands on the newest packet when it mounts with packets', () => {
    render(<PacketLog packets={range(0, 50)} />);
    expect(listRecorder.mounts).toEqual([NEWEST]);
  });

  it('lands on the newest packet again after switching views away and back', () => {
    // MainPane renders one panel at a time, so leaving the Packet Log unmounts it.
    const { rerender } = render(<PacketLog packets={range(0, 50)} />);
    rerender(<div>another panel</div>);
    rerender(<PacketLog packets={range(0, 60)} />);
    expect(listRecorder.mounts).toEqual([NEWEST, NEWEST]);
  });

  it('mounts the list, landing on the newest packet, once rows arrive after mount (snapshot hydrates late)', () => {
    // The Packet Log is the default view, so it mounts before hydrate() fills the store.
    const { rerender } = render(<PacketLog packets={[]} />);
    expect(screen.getByText('No packets match this filter.')).toBeTruthy();
    expect(listRecorder.mounts).toEqual([]);

    rerender(<PacketLog packets={range(0, 50)} />);
    expect(listRecorder.mounts).toEqual([NEWEST]);
  });

  it('lands on the newest packet again after the list empties and refills', () => {
    // The list reads initialLocation only when it mounts, so a clear must remount it.
    // A list kept mounted through the empty state refills at the top.
    const { rerender } = render(<PacketLog packets={[pkt(0)]} />);
    rerender(<PacketLog packets={[]} />);
    rerender(<PacketLog packets={range(1, 4)} />);
    expect(listRecorder.mounts).toEqual([NEWEST, NEWEST]);
  });

  it('keeps one list across appends and never scrolls it imperatively', () => {
    // An imperative scroll-on-change is how a scrolled-up user gets yanked to the bottom.
    const { rerender } = render(<PacketLog packets={range(0, 2)} />);
    rerender(<PacketLog packets={range(0, 3)} />);
    rerender(<PacketLog packets={[]} />);
    rerender(<PacketLog packets={range(3, 6)} />);

    expect(listRecorder.data?.data).toHaveLength(3);
    expect(listRecorder.calls).toEqual([]);
  });
});

// What the list reports when the user has scrolled so that `index` is the bottom-most
// visible row, its bottom edge `edge` px from the viewport's.
const scrolledTo = (index: number, edge = -1.25) => ({
  isAtBottom: false,
  lastVisibleItemIndex: index,
  lastItemBottomOffset: edge,
  listOffset: -1000,
  scrollHeight: 60000,
  visibleListHeight: 600,
  bottomOffset: 1600,
});

describe('PacketLog scroll position across view switches', () => {
  it('returns to where it was scrolled after switching views away and back', () => {
    const { rerender } = render(<PacketLog packets={range(0, 50)} />);
    listRecorder.onScroll?.(scrolledTo(30));
    rerender(<div>another panel</div>);
    rerender(<PacketLog packets={range(0, 50)} />);
    expect(listRecorder.mounts).toEqual([NEWEST, { index: 30, align: 'end', offset: -1.25 }]);
  });

  it('keeps the same packet at the bottom edge when packets were added and trimmed while away', () => {
    const { rerender } = render(<PacketLog packets={range(0, 50)} />);
    listRecorder.onScroll?.(scrolledTo(30)); // pkt-30
    rerender(<div>another panel</div>);
    // The buffer trimmed 10 from the head and gained 10 at the tail: pkt-30 is now index 20.
    rerender(<PacketLog packets={range(10, 60)} />);
    expect(listRecorder.mounts[1]).toEqual({ index: 20, align: 'end', offset: -1.25 });
  });

  it('lands on the newest packet when the remembered packet has rolled out of the log', () => {
    const { rerender } = render(<PacketLog packets={range(0, 50)} />);
    listRecorder.onScroll?.(scrolledTo(5));
    rerender(<div>another panel</div>);
    rerender(<PacketLog packets={range(40, 90)} />);
    expect(listRecorder.mounts).toEqual([NEWEST, NEWEST]);
  });

  it('lands on the newest packet when it was left at the bottom', () => {
    const { rerender } = render(<PacketLog packets={range(0, 50)} />);
    listRecorder.onScroll?.(scrolledTo(30));
    listRecorder.onScroll?.({ ...scrolledTo(49, 0), isAtBottom: true });
    rerender(<div>another panel</div>);
    rerender(<PacketLog packets={range(0, 60)} />);
    expect(listRecorder.mounts).toEqual([NEWEST, NEWEST]);
  });

  it("doesn't chase packets arriving while it restores, but refills after a clear on the newest", () => {
    const { rerender } = render(<PacketLog packets={range(0, 50)} />);
    listRecorder.onScroll?.(scrolledTo(30));
    rerender(<div>another panel</div>);
    rerender(<PacketLog packets={range(0, 50)} />);
    rerender(<PacketLog packets={range(0, 51)} />);
    const modifier = listRecorder.data?.scrollModifier as { autoScroll: ItemLocationCallback };
    const restoring = modifier.autoScroll;
    // Mid-landing the list reports no scroll location yet. Following there would drag it to the bottom.
    expect(restoring({ atBottom: false, scrollInProgress: false, scrollLocation: { scrollHeight: 0 } } as never)).toBe(
      false,
    );

    rerender(<PacketLog packets={[]} />);
    rerender(<PacketLog packets={range(60, 70)} />);
    expect(listRecorder.mounts).toEqual([NEWEST, { index: 30, align: 'end', offset: -1.25 }, NEWEST]);
  });
});

describe('PacketLog selection across view switches', () => {
  it('keeps the selected packet while it is still in the log', () => {
    useStore.setState({ selectedPacketId: 'pkt-3' });
    render(<PacketLog packets={range(0, 10)} />);
    expect(useStore.getState().selectedPacketId).toBe('pkt-3');
  });

  it('drops the selection when its packet is evicted from the head while the log is open', () => {
    useStore.setState({ selectedPacketId: 'pkt-0' });
    const { rerender } = render(<PacketLog packets={range(0, 10)} />);
    expect(useStore.getState().selectedPacketId).toBe('pkt-0');
    rerender(<PacketLog packets={range(1, 11)} />);
    expect(useStore.getState().selectedPacketId).toBeNull();
  });

  it('drops a remembered selection that has rolled out of the log', () => {
    useStore.setState({ selectedPacketId: 'pkt-3' });
    render(<PacketLog packets={range(5, 10)} />);
    expect(useStore.getState().selectedPacketId).toBeNull();
  });

  it('navigating away keeps the packet selection but not a message selection', () => {
    useStore.setState({ selectedPacketId: 'pkt-3', selectedMessageId: 'msg-1' });
    useStore.getState().setActiveKey('ch:somewhere');
    expect(useStore.getState().selectedPacketId).toBe('pkt-3');
    expect(useStore.getState().selectedMessageId).toBeNull();
    useStore.getState().setActiveKey('tool:packetlog');
  });
});

describe('PacketLog follow policy', () => {
  const policy = () => {
    render(<PacketLog packets={range(0, 3)} />);
    const modifier = listRecorder.data?.scrollModifier as { type: string; autoScroll: ItemLocationCallback };
    expect(modifier.type).toBe('auto-scroll-to-bottom');
    return modifier.autoScroll;
  };
  const at = (atBottom: boolean, scrollHeight: number, scrollInProgress = false) =>
    ({ atBottom, scrollInProgress, scrollLocation: { scrollHeight } }) as Parameters<ItemLocationCallback>[0];

  it('follows new packets from the bottom', () => {
    expect(policy()(at(true, 4000))).toBeTruthy();
  });

  it('leaves a user scrolled up to inspect an older packet where they are', () => {
    expect(policy()(at(false, 4000))).toBe(false);
  });

  it('follows a packet that arrives while the list is still landing after a mount', () => {
    // Before the list reports a scroll location it reads as "not at bottom". Skipping the
    // packet there left the list a row short of the bottom, and it never followed again.
    // And instantly: the list's first data publish lands in this window too, so 'smooth'
    // visibly animated the whole log from the top to the newest packet on every mount.
    expect(policy()(at(false, 0))).toBe('auto');
  });
});
