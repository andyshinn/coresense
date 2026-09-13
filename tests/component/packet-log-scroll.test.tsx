import { render } from '@testing-library/react';
import { forwardRef, useImperativeHandle } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PacketLog } from '@/components/PacketLog';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';

// jsdom has no layout, so the real Virtuoso can't show where the list is scrolled.
// Record the imperative calls instead.
const scrollToIndex = vi.fn();
vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function VirtuosoRecorder(_props: unknown, ref) {
    useImperativeHandle(ref, () => ({ scrollToIndex }));
    return null;
  }),
}));

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

beforeEach(() => {
  scrollToIndex.mockClear();
  useStore.setState({ selectedPacketId: null });
  useStore.getState().setPacketLogFilter({ source: 'both' });
});

describe('PacketLog scroll-to-newest', () => {
  it('lands on the newest packet when rows arrive after mount (snapshot hydrates late)', () => {
    // The Packet Log is the default view, so it mounts before hydrate() fills the store.
    const { rerender } = render(<PacketLog packets={[]} />);
    expect(scrollToIndex).not.toHaveBeenCalled();

    rerender(<PacketLog packets={Array.from({ length: 50 }, (_, i) => pkt(i))} />);
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 49, align: 'end' });
  });

  it('does not re-scroll on every appended packet (followOutput owns that)', () => {
    const { rerender } = render(<PacketLog packets={[pkt(0), pkt(1)]} />);
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    rerender(<PacketLog packets={[pkt(0), pkt(1), pkt(2)]} />);
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
  });

  it('lands on the newest packet again after the list empties and refills', () => {
    const { rerender } = render(<PacketLog packets={[pkt(0)]} />);
    rerender(<PacketLog packets={[]} />);
    scrollToIndex.mockClear();

    rerender(<PacketLog packets={[pkt(1), pkt(2), pkt(3)]} />);
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'end' });
  });
});
