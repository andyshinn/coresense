import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketDetailsRail } from '@/components/packet/PacketDetailsRail';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';
import { ADVERT_HEX, GROUP_TEXT_ENCRYPTED_HEX, GROUP_TEXT_SECRET_HEX, TEXT_MESSAGE_HEX } from '../support/packetFixtures';

const gt: LivePacket = {
  id: 'pkt-0',
  timestamp: Date.parse('2026-07-10T20:26:00Z'),
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex: '1501782abbcc00112233',
  payloadBytes: [],
  snr: 5,
  rssi: -84,
};

beforeEach(() => {
  useStore.setState({ packets: [gt], selectedPacketId: null, channels: [], contacts: [], owner: null });
});

describe('PacketDetailsRail', () => {
  it('shows the empty state with a Decode button when nothing is selected', () => {
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/Decode hex/i)).toBeTruthy();
  });

  it('renders the byte breakdown for a selected packet', () => {
    useStore.setState({ selectedPacketId: 'pkt-0' });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/Packet Byte Breakdown/i)).toBeTruthy();
    expect(screen.getByText(/Group Text Payload Byte Breakdown/i)).toBeTruthy();
  });

  it('renders "BLE Frame Breakdown" for a selected companion packet', () => {
    const ble: LivePacket = {
      id: 'pkt-ble',
      timestamp: Date.parse('2026-07-10T20:26:00Z'),
      transportType: 'ble',
      kind: 'companion',
      hex: '83',
      bytes: [],
      payloadHex: '2a01aabbccdd6869',
      payloadBytes: [],
      code: 0x83,
      codeName: 'RESP_CHANNEL_MSG_RECV',
    };
    useStore.setState({ packets: [ble], selectedPacketId: 'pkt-ble', channels: [] });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/BLE Frame Breakdown/i)).toBeTruthy();
  });

  it('renders the "Advert App-Data" secondary for a selected Advert packet', () => {
    const advert: LivePacket = { ...gt, id: 'pkt-advert', payloadHex: ADVERT_HEX };
    useStore.setState({ packets: [advert], selectedPacketId: 'pkt-advert', channels: [] });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText('Advert App-Data')).toBeTruthy();
  });

  it('renders the DM lock note for a TextMessage packet with no shared key', () => {
    const dm: LivePacket = { ...gt, id: 'pkt-dm', payloadHex: TEXT_MESSAGE_HEX };
    useStore.setState({ packets: [dm], selectedPacketId: 'pkt-dm', channels: [] });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText(/End-to-end encrypted between sender and recipient/i)).toBeTruthy();
  });

  it('decrypts a channel packet with a held secret and shows the full "sender: message" plaintext', () => {
    const enc: LivePacket = { ...gt, id: 'pkt-enc', payloadHex: GROUP_TEXT_ENCRYPTED_HEX };
    useStore.setState({
      packets: [enc],
      selectedPacketId: 'pkt-enc',
      channels: [{ key: 'ch:Public', name: 'Public', kind: 'public', secretHex: GROUP_TEXT_SECRET_HEX }],
    });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText('Decrypted Plaintext')).toBeTruthy();
    // The decoder splits off the sender; the Message field must show the real plaintext.
    expect(screen.getByText('bob: hello')).toBeTruthy();
  });

  it('shows every route a flood packet was heard by, collapsed until one is opened', () => {
    // The same GroupText heard again over a second, 2-hop route.
    const twoHop: LivePacket = { ...gt, id: 'pkt-1', payloadHex: '15027811' + '2abbcc00112233', snr: -2 };
    useStore.setState({
      packets: [gt, twoHop],
      selectedPacketId: 'pkt-0',
      contacts: [{ key: 'c:78aa', publicKeyHex: '78aa', name: 'Hilltop', kind: 'repeater' }],
    });
    render(<PacketDetailsRail client={null} />);
    expect(screen.getByText('HEARD VIA')).toBeTruthy();
    expect(screen.getByText('2 paths')).toBeTruthy();
    expect(screen.getByText(/Heard 2/)).toBeTruthy();
    const routes = screen.getAllByRole('button', { expanded: false });
    expect(routes).toHaveLength(2);
    expect(screen.queryByText('Hop 1 · 78aa')).toBeNull();

    // Opening the 1-hop route shows its hop resolved to the known repeater.
    fireEvent.click(routes[0]);
    expect(screen.getByText('Hop 1 · 78aa')).toBeTruthy();
    expect(screen.getByText('Unknown sender')).toBeTruthy();
    expect(screen.getByText('You received the packet')).toBeTruthy();
  });

  it('has no heard-via block for a direct packet, whose path is the route still ahead', () => {
    const dm: LivePacket = { ...gt, id: 'pkt-dm', payloadHex: TEXT_MESSAGE_HEX };
    useStore.setState({ packets: [dm], selectedPacketId: 'pkt-dm' });
    render(<PacketDetailsRail client={null} />);
    expect(screen.queryByText('HEARD VIA')).toBeNull();
  });
});
