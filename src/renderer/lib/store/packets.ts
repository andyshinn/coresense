import type { RawPacket, UiState } from '../../../shared/types';
import type { PacketLogColumn, PacketLogColumnWidths } from '../packetLogColumns';
import type { SliceCreator } from './coreState';
import type { LivePacket, PacketLogView } from './types';
import { keepLast } from './util';

// Monotonic id for live + hydrated packets so list keys and selection never
// collide regardless of source. Not persisted; a reload restarts the counter
// and re-ids the hydrated set.
let packetSeq = 0;
const nextPacketId = () => `pkt-${packetSeq++}`;

/**
 * Packets for hydrate(): the snapshot's history plus any packets that arrived over
 * the WebSocket while the snapshot request was in flight (App starts both at once).
 * Replacing the array dropped those, and with stored history off they were lost.
 * A packet can be in both, since main persists before it broadcasts; the copy
 * already in the store keeps its id so a selection or scroll anchor on it survives.
 */
export function mergeHydratedPackets(snapshot: RawPacket[], live: LivePacket[], cap: number): LivePacket[] {
  const key = (p: RawPacket) => `${p.timestamp}:${p.hex}`;
  const liveByKey = new Map(live.map((p) => [key(p), p]));
  const merged = snapshot.map((p) => {
    const existing = liveByKey.get(key(p));
    if (existing) liveByKey.delete(key(p));
    return existing ?? { ...p, id: nextPacketId() };
  });
  return keepLast([...merged, ...liveByKey.values()], cap);
}

/**
 * Back-compat: older ui-state.json stored { showCompanion }. By the time this
 * runs at hydrate, `f` has already been through main's deep mergeDefaults,
 * which injects a fresh `source: 'both'` alongside any legacy
 * `showCompanion` that was actually on disk — so a plain `'source' in f`
 * check would win over the legacy key and silently discard the user's real
 * preference (e.g. an old "hide BLE" of showCompanion:false would come back
 * as 'both' instead of 'rf'). Check `showCompanion` FIRST so a legacy value,
 * when present, always takes precedence over an injected default `source`.
 */
export function migratePacketLogFilter(f: unknown): { source: 'both' | 'rf' | 'ble' } {
  if (f && typeof f === 'object' && 'showCompanion' in f)
    return { source: (f as { showCompanion: boolean }).showCompanion ? 'both' : 'rf' };
  if (f && typeof f === 'object' && 'source' in f) return { source: (f as { source: 'both' | 'rf' | 'ble' }).source };
  return { source: 'both' };
}

/** The live packet log and its view state. Its retention and filter are
 *  persisted, so they live in `ui` and the actions below write there too. */
export interface PacketsSlice {
  // Live packet log (capped ring buffer)
  packets: LivePacket[];
  // ID of the packet currently inspected in the right rail. Kept across navigation
  // (unlike selectedMessageId) so returning to the Packet Log shows it again.
  selectedPacketId: string | null;
  packetLogView: PacketLogView | null;
  setPacketLogView: (view: PacketLogView | null) => void;
  /** Packet Log column widths the user dragged. Session memory only. */
  packetLogColumns: PacketLogColumnWidths;
  /** Null resets the column to its default (for Time, the width that fits the time format). */
  setPacketLogColumnWidth: (column: PacketLogColumn, width: number | null) => void;
  // Packet decoder dialog open state. Not persisted across reloads.
  decoderOpen: boolean;

  applyPacket: (p: RawPacket) => void;
  setSelectedPacket: (id: string | null) => void;
  setPacketLogSettings: (patch: Partial<UiState['packetLog']>) => void;
  setPacketLogFilter: (patch: Partial<UiState['packetLogFilter']>) => void;
  setDecoderOpen: (open: boolean) => void;
  clearPackets: () => void;
}

export const createPacketsSlice: SliceCreator<PacketsSlice> = (set) => ({
  packets: [],
  selectedPacketId: null,
  packetLogView: null,
  packetLogColumns: {},
  decoderOpen: false,

  applyPacket: (p) =>
    set((s) => {
      const withId: LivePacket = { ...p, id: nextPacketId() };
      return { packets: keepLast([...s.packets, withId], s.ui.packetLog.liveBufferSize) };
    }),
  setSelectedPacket: (id) => set(() => ({ selectedPacketId: id })),
  setPacketLogView: (view) => set(() => ({ packetLogView: view })),
  setPacketLogColumnWidth: (column, width) =>
    set((s) => {
      const next = { ...s.packetLogColumns };
      if (width == null) delete next[column];
      else next[column] = width;
      return { packetLogColumns: next };
    }),
  setPacketLogSettings: (patch) =>
    set((s) => {
      const packetLog = { ...s.ui.packetLog, ...patch };
      return { ui: { ...s.ui, packetLog }, packets: keepLast(s.packets, packetLog.liveBufferSize) };
    }),
  setPacketLogFilter: (patch) => set((s) => ({ ui: { ...s.ui, packetLogFilter: { ...s.ui.packetLogFilter, ...patch } } })),
  setDecoderOpen: (open) => set(() => ({ decoderOpen: open })),
  clearPackets: () => set(() => ({ packets: [] })),
});
