import { useMemo } from 'react';
import type { PacketSender } from '../../lib/packetInspect';
import { originHop, packetHeardVia } from '../../lib/packetPath';
import { type LivePacket, useStore } from '../../lib/store';
import { PathViewer } from '../path/PathViewer';

/** The route(s) a flood packet reached this radio by, in the channel pane's path
 *  viewer. Renders nothing for packets whose path isn't a record of where they've
 *  been (direct routes, trace). Its own component so the whole packet buffer
 *  subscription re-renders only this block, not the byte breakdowns. */
export function PacketHeardVia({ packet, sender }: { packet: LivePacket; sender: PacketSender | null }) {
  const packets = useStore((s) => s.packets);
  const contacts = useStore((s) => s.contacts);
  const ownerName = useStore((s) => s.owner?.name ?? null);

  const repeaters = useMemo(() => contacts.filter((c) => c.kind === 'repeater'), [contacts]);
  const heard = useMemo(
    () => packetHeardVia(packet, packets, { origin: originHop(sender, contacts), ownerName }),
    [packet, packets, sender, contacts, ownerName],
  );
  if (!heard) return null;

  return (
    <div className="mt-3">
      <div className="mb-1 font-mono text-[10px] tracking-wide text-cs-text-dim">HEARD VIA</div>
      <PathViewer
        paths={heard.paths}
        timesHeard={heard.timesHeard}
        knownRepeaters={repeaters}
        defaultOpenPathId={heard.selectedPathId}
        subject="packet"
      />
    </div>
  );
}
