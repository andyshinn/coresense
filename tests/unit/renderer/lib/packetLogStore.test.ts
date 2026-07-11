import { beforeEach, describe, expect, it } from 'vitest';
import { migratePacketLogFilter, useStore } from '../../../../src/renderer/lib/store';
import { DEFAULT_UI_STATE } from '../../../../src/shared/types';

const reset = () => useStore.setState({ packets: [], selectedPacketId: null, ui: structuredClone(DEFAULT_UI_STATE) });

beforeEach(reset);

describe('packet log store', () => {
  it('assigns a stable unique id to each applied packet', () => {
    const p = {
      timestamp: 1,
      transportType: 'ble',
      kind: 'mesh',
      hex: '88',
      bytes: [0x88],
      payloadHex: '15',
      payloadBytes: [0x15],
    } as const;
    useStore.getState().applyPacket({ ...p });
    useStore.getState().applyPacket({ ...p });
    const ids = useStore.getState().packets.map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('caps the live buffer at liveBufferSize', () => {
    useStore.getState().setPacketLogSettings({ liveBufferSize: 3 });
    for (let i = 0; i < 6; i++)
      useStore.getState().applyPacket({
        timestamp: i,
        transportType: 'ble',
        kind: 'mesh',
        hex: '88',
        bytes: [],
        payloadHex: '',
        payloadBytes: [],
      });
    expect(useStore.getState().packets).toHaveLength(3);
  });

  it('trims the buffer immediately when liveBufferSize decreases', () => {
    for (let i = 0; i < 5; i++)
      useStore.getState().applyPacket({
        timestamp: i,
        transportType: 'ble',
        kind: 'mesh',
        hex: '88',
        bytes: [],
        payloadHex: '',
        payloadBytes: [],
      });
    useStore.getState().setPacketLogSettings({ liveBufferSize: 2 });
    expect(useStore.getState().packets).toHaveLength(2);
    expect(useStore.getState().packets.map((p) => p.timestamp)).toEqual([3, 4]);
  });

  it('migrates a legacy showCompanion filter to a source', () => {
    expect(migratePacketLogFilter({ showCompanion: true }).source).toBe('both');
    expect(migratePacketLogFilter({ showCompanion: false }).source).toBe('rf');
    expect(migratePacketLogFilter({ source: 'ble' }).source).toBe('ble');
  });
});
