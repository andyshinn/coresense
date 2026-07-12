import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { PacketDetailsRail } from '@/components/packet/PacketDetailsRail';
import type { LivePacket } from '@/lib/store';
import { useStore } from '@/lib/store';
import { ADVERT_HEX, TEXT_MESSAGE_HEX } from '../support/packetFixtures';

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
  useStore.setState({ packets: [gt], selectedPacketId: null, channels: [] });
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
    expect(screen.getByText(/no shared secret to decrypt/i)).toBeTruthy();
  });

  // The successful channel-DECRYPT secondary path ("Decrypted Plaintext") needs a
  // real GroupText ciphertext + matching channel secret fixture to exercise
  // MeshCoreDecoder's decryption — skipped here; would need a crypto fixture beyond
  // this suite's scope.
});
