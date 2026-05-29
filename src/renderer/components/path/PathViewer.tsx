// Port of the Path Viewer v2 handoff design
// (docs/path/meshcore-desktop-application/project/Path Viewer v2.html). Renders
// every flood path a message arrived through, with per-hop prefix resolution
// against the local repeater-contact set.
//
// Per-hop SNR is intentionally not rendered: MeshCore only measures SNR for
// the final hop (our radio), exposed once per path on the summary row.
//
// Conflict resolution: when ≥2 known repeaters share a hop's prefix, the row
// shows a "N known repeaters" chip that expands an inline ConflictPanel.
// `onSelectCandidate` is currently a UI-only callback — pinning resolution to
// persistent state is a follow-up.

import { useState } from 'react';
import type { Contact, MessageHop, MessagePath } from '../../../shared/types';
import { PathItem } from './PathItem';

interface PathViewerProps {
  paths: MessagePath[];
  timesHeard: number;
  knownRepeaters: Contact[];
  onSelectCandidate?: (hop: MessageHop, contact: Contact) => void;
  onHopClick?: (hop: MessageHop) => void;
  defaultOpenPathId?: string;
}

export function PathViewer({
  paths,
  timesHeard,
  knownRepeaters,
  onSelectCandidate,
  onHopClick,
  defaultOpenPathId,
}: PathViewerProps) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenPathId ?? paths[0]?.id ?? null);

  if (paths.length === 0) {
    return <p className="italic text-cs-text-dim">no path data</p>;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between pb-1.5 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
        <span>
          Heard {timesHeard}
          <span aria-hidden>×</span>
        </span>
        <span>{paths.length === 1 ? '1 path' : `${paths.length} paths`}</span>
      </div>
      <div className="mt-1 flex flex-col">
        {paths.map((p) => (
          <PathItem
            key={p.id}
            path={p}
            knownRepeaters={knownRepeaters}
            open={openId === p.id}
            onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            onHopClick={onHopClick}
            onSelectCandidate={onSelectCandidate}
          />
        ))}
      </div>
    </div>
  );
}
