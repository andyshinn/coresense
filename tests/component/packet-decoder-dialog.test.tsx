import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketDecoderDialog } from '@/components/packet/PacketDecoderDialog';
import { useStore } from '@/lib/store';

beforeEach(() => {
  useStore.getState().setDecoderOpen(true);
  useStore.setState({ channels: [] });
});

describe('PacketDecoderDialog', () => {
  it('decodes pasted hex into a byte breakdown', () => {
    render(<PacketDecoderDialog />);
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: '1501782abbcc00112233' } });
    fireEvent.click(screen.getByRole('button', { name: /decode/i }));
    expect(screen.getByText(/Packet Byte Breakdown/i)).toBeTruthy();
  });

  it('names a pasted BLE frame from its type code and applies that frame layout', () => {
    render(<PacketDecoderDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'BLE frame' }));
    // RESP_CURR_TIME (0x09) followed by its 4-byte clock body.
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: '0978563412' } });
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    expect(screen.getByText('Device Clock')).toBeTruthy();
    expect(screen.queryByText('Body')).toBeNull();
  });

  it('decodes base64 too', () => {
    render(<PacketDecoderDialog />);
    // base64 of the GroupText fixture bytes: 15 01 78 2a bb cc 00 11 22 33
    // (computed via Buffer.from('1501782abbcc00112233','hex').toString('base64'))
    fireEvent.change(screen.getByPlaceholderText(/paste/i), { target: { value: 'FQF4KrvMABEiMw==' } });
    fireEvent.click(screen.getByRole('button', { name: /decode/i }));
    expect(screen.getByText(/Packet Byte Breakdown/i)).toBeTruthy();
  });
});
