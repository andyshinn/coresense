import { useState } from 'react';
import type { Contact, MessageHop } from '../../../shared/types';
import { HopRow } from './HopRow';

export function PathTimeline({
  hops,
  knownRepeaters,
  onHopClick,
  onSelectCandidate,
}: {
  hops: MessageHop[];
  knownRepeaters: Contact[];
  onHopClick?: (hop: MessageHop) => void;
  onSelectCandidate?: (hop: MessageHop, contact: Contact) => void;
}) {
  const [openConflict, setOpenConflict] = useState<number | null>(null);
  return (
    <div className="px-2 pb-3 pt-1">
      {hops.map((hop, i) => {
        const hopIndex = hop.kind === 'hop' ? hops.slice(0, i).filter((h) => h.kind === 'hop').length + 1 : null;
        return (
          <HopRow
            // biome-ignore lint/suspicious/noArrayIndexKey: hops can repeat shortId; index disambiguates
            key={`${i}.${hop.shortId}`}
            hop={hop}
            hopIndex={hopIndex}
            isLast={i === hops.length - 1}
            knownRepeaters={knownRepeaters}
            conflictOpen={openConflict === i}
            onToggleConflict={() => setOpenConflict(openConflict === i ? null : i)}
            onHopClick={onHopClick}
            onSelectCandidate={onSelectCandidate}
          />
        );
      })}
    </div>
  );
}
