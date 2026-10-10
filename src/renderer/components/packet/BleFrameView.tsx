import { useState } from 'react';
import type { BleFrameInspection } from '../../lib/bleFrameLayouts';
import { PacketBreakdown } from './PacketBreakdown';

/** A companion (BLE) frame's byte breakdown. Owns its hover spotlight, so key it
 *  on the frame for the same reason as PacketInspectionView. */
export function BleFrameView({ frame }: { frame: BleFrameInspection }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <PacketBreakdown
      title="BLE Frame Breakdown"
      count={frame.bytes.length}
      bytes={frame.bytes}
      fields={frame.fields}
      scope="ble"
      hovered={hovered}
      setHovered={setHovered}
    />
  );
}
