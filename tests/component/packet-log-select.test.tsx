import { fireEvent, render, screen } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PacketLog } from '@/components/PacketLog';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';
import { useDeselectOnOutsideClick } from '@/shell/useDeselectOnOutsideClick';

// Without layout the real list renders at most one row under jsdom; the recorder renders them all.
vi.mock('@virtuoso.dev/message-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@virtuoso.dev/message-list')>()),
  ...(await import('../support/messageListRecorder')),
}));

const pkt = (id: string, over: Partial<LivePacket> = {}): LivePacket => ({
  id,
  timestamp: Date.parse('2026-07-10T20:26:00Z'),
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: '0a00cbe31122aabbccdd',
  payloadBytes: [],
  snr: 5,
  rssi: -70,
  ...over,
});

beforeEach(() => {
  useStore.setState({ selectedPacketId: null });
  useStore.getState().setPacketLogFilter({ source: 'both' });
});

describe('PacketLog list', () => {
  it('renders a row per packet and selects on click', () => {
    render(<PacketLog packets={[pkt('pkt-0'), pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT' })]} />);
    const rows = screen.getAllByTestId('packet-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(rows[0]);
    expect(useStore.getState().selectedPacketId).toBe('pkt-0');
  });

  it('filters to RF only when source=rf', () => {
    useStore.getState().setPacketLogFilter({ source: 'rf' });
    render(<PacketLog packets={[pkt('pkt-0'), pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT' })]} />);
    expect(screen.getAllByTestId('packet-row')).toHaveLength(1);
  });

  it('filters to BLE (companion) only when source=ble', () => {
    useStore.getState().setPacketLogFilter({ source: 'ble' });
    render(<PacketLog packets={[pkt('pkt-0'), pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT' })]} />);
    const rows = screen.getAllByTestId('packet-row');
    expect(rows).toHaveLength(1);
    expect(screen.getByText('PUSH ADVERT')).toBeTruthy();
  });

  it('shows a humanized type name for a GroupText mesh packet', () => {
    render(<PacketLog packets={[pkt('pkt-0', { payloadHex: '1501782abbcc00112233' })]} />);
    expect(screen.getByText('Group Text')).toBeTruthy();
  });

  it('does not show a mesh-decode error in DETAILS for a companion row', () => {
    render(<PacketLog packets={[pkt('pkt-1', { kind: 'companion', codeName: 'PUSH_ADVERT', payloadHex: 'deadbeef' })]} />);
    expect(screen.queryByText(/too short|invalid|error/i)).toBeNull();
  });
});

function Harness() {
  useDeselectOnOutsideClick();
  return (
    <div>
      <button type="button" data-testid="packet-row" onClick={() => useStore.getState().setSelectedPacket('pkt-9')}>
        row
      </button>
      <button type="button" data-testid="outside">
        outside
      </button>
      {/* flushSync: a real browser commits a discrete click before it bubbles to document. */}
      <button type="button" data-testid="nav-away" onClick={() => flushSync(() => useStore.getState().setActiveKey('ch:x'))}>
        nav away
      </button>
      <button
        type="button"
        data-testid="nav-packetlog"
        onClick={() => flushSync(() => useStore.getState().setActiveKey('tool:packetlog'))}
      >
        nav to packet log
      </button>
    </div>
  );
}

describe('packet deselect-on-outside-click', () => {
  beforeEach(() => {
    useStore.getState().setActiveKey('tool:packetlog');
  });

  it('clears selectedPacketId when clicking outside', () => {
    useStore.getState().setSelectedPacket('pkt-1');
    render(<Harness />);
    fireEvent.click(screen.getByTestId('outside'));
    expect(useStore.getState().selectedPacketId).toBeNull();
  });

  it('keeps the selection through the nav click that leaves the Packet Log and the one that returns', () => {
    useStore.getState().setSelectedPacket('pkt-1');
    render(<Harness />);
    fireEvent.click(screen.getByTestId('nav-away'));
    expect(useStore.getState().selectedPacketId).toBe('pkt-1');
    fireEvent.click(screen.getByTestId('outside'));
    expect(useStore.getState().selectedPacketId).toBe('pkt-1');
    fireEvent.click(screen.getByTestId('nav-packetlog'));
    expect(useStore.getState().selectedPacketId).toBe('pkt-1');
  });

  it('keeps the selection when clicking a packet row', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('packet-row'));
    expect(useStore.getState().selectedPacketId).toBe('pkt-9');
  });
});
