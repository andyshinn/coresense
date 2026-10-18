import { useState } from 'react';
import type { PacketInspection } from '../../lib/packetInspect';
import { PacketBreakdown } from './PacketBreakdown';
import { PacketSecondary } from './PacketSecondary';

/** A decoded mesh packet's byte breakdowns: the whole packet, then its payload
 *  and the payload's secondary view. Shared by PacketDetailsRail and
 *  PacketDecoderDialog so both surfaces stay in sync.
 *
 *  Owns the byte↔field hover spotlight. Field keys (pk0, pl0, …) repeat across
 *  packets, so callers key this on the packet: a stale hover carried over to a
 *  new one would highlight the wrong field. */
export function PacketInspectionView({ inspection: d }: { inspection: PacketInspection }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <>
      <PacketBreakdown
        title="Packet Byte Breakdown"
        count={d.size}
        bytes={d.bytes}
        fields={d.fields}
        scope="packet"
        hovered={hovered}
        setHovered={setHovered}
      />

      {d.payload && (
        <>
          <PacketBreakdown
            title={`${d.payload.typeName} Payload Byte Breakdown`}
            count={d.payload.bytes.length}
            bytes={d.payload.bytes}
            fields={d.payload.fields}
            scope="payload"
            hovered={hovered}
            setHovered={setHovered}
          />

          <PacketSecondary secondary={d.payload.secondary} hovered={hovered} setHovered={setHovered} />
        </>
      )}
    </>
  );
}
