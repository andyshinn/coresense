import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PacketLog } from '@/components/PacketLog';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';

vi.mock('@virtuoso.dev/message-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@virtuoso.dev/message-list')>()),
  ...(await import('../support/messageListRecorder')),
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

const template = (container: HTMLElement) =>
  (container.querySelector('section') as HTMLElement).style.getPropertyValue('--packet-log-cols');
const handle = (name: string) => screen.getByRole('separator', { name: `Resize ${name} column` });

beforeAll(() => {
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  useStore.setState({ packetLogColumns: {}, selectedPacketId: null, packetLogView: null });
  useStore.getState().setPacketLogFilter({ source: 'both' });
});

describe('PacketLog columns', () => {
  it('shares one grid template between the header and the rows', () => {
    const { container } = render(<PacketLog packets={[pkt(0)]} />);
    // jsdom has no layout, so Time falls back to its default instead of the measured fit.
    expect(template(container)).toBe('70px 112px minmax(0,1fr) 92px 30px');
    expect(screen.getByTestId('packet-row').className).toContain('grid-cols-(--packet-log-cols)');
  });

  it('widens a left-side column when its right-edge handle is dragged right', () => {
    const { container } = render(<PacketLog packets={[pkt(0)]} />);
    fireEvent.pointerDown(handle('time'), { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle('time'), { pointerId: 1, clientX: 140 });
    fireEvent.pointerUp(handle('time'), { pointerId: 1, clientX: 140 });
    expect(useStore.getState().packetLogColumns).toEqual({ time: 110 });
    expect(template(container)).toBe('110px 112px minmax(0,1fr) 92px 30px');
  });

  it('widens a right-side column when its left-edge handle is dragged left', () => {
    render(<PacketLog packets={[pkt(0)]} />);
    fireEvent.pointerDown(handle('rssi/snr'), { pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(handle('rssi/snr'), { pointerId: 1, clientX: 470 });
    fireEvent.pointerUp(handle('rssi/snr'), { pointerId: 1, clientX: 470 });
    expect(useStore.getState().packetLogColumns).toEqual({ rssi: 122 });
  });

  it('cancels a drag on Esc, leaving a never-resized column at its default', () => {
    render(<PacketLog packets={[pkt(0)]} />);
    fireEvent.pointerDown(handle('type'), { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(handle('type'), { pointerId: 1, clientX: 160 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerMove(handle('type'), { pointerId: 1, clientX: 200 });
    expect(useStore.getState().packetLogColumns).toEqual({});
  });

  it('resizes from the keyboard and resets on double-click', () => {
    render(<PacketLog packets={[pkt(0)]} />);
    fireEvent.keyDown(handle('hop'), { key: 'ArrowLeft' });
    expect(useStore.getState().packetLogColumns).toEqual({ hop: 38 });
    fireEvent.doubleClick(handle('hop'));
    expect(useStore.getState().packetLogColumns).toEqual({});
  });

  it('keeps dragged widths when the panel remounts after a view switch', () => {
    const { rerender, container } = render(<PacketLog packets={[pkt(0)]} />);
    fireEvent.keyDown(handle('type'), { key: 'ArrowRight' });
    rerender(<div>another panel</div>);
    rerender(<PacketLog packets={[pkt(0)]} />);
    expect(template(container)).toBe('70px 120px minmax(0,1fr) 92px 30px');
  });
});
