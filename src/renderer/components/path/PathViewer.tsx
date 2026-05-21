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

import { AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Contact, MessageHop, MessagePath } from '../../../shared/types';
import { cn } from '../../lib/utils';

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
      <div className="flex items-start gap-1.5 rounded border border-cs-border bg-cs-bg-3 px-2 py-1.5 text-[11px] text-cs-text-muted">
        <Info size={12} className="mt-0.5 shrink-0 text-cs-text-dim" aria-hidden />
        <span>Routes your radio heard this message via.</span>
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

function PathItem({
  path,
  knownRepeaters,
  open,
  onToggle,
  onHopClick,
  onSelectCandidate,
}: {
  path: MessagePath;
  knownRepeaters: Contact[];
  open: boolean;
  onToggle: () => void;
  onHopClick?: (hop: MessageHop) => void;
  onSelectCandidate?: (hop: MessageHop, contact: Contact) => void;
}) {
  const lastRepeater = path.hops[path.hops.length - 2] ?? path.hops[path.hops.length - 1];
  const lastRepeaterMatch =
    lastRepeater.kind === 'hop' ? candidatesFor(lastRepeater, knownRepeaters)[0] : null;
  const lastRepeaterLabel =
    lastRepeaterMatch?.name ?? (lastRepeater.unnamed ? null : (lastRepeater.name ?? null));
  const hopCount = path.hops.filter((h) => h.kind === 'hop').length;
  const conflictCount = useMemo(() => {
    return path.hops.reduce((n, h) => {
      if (h.kind !== 'hop') return n;
      const cands = candidatesFor(h, knownRepeaters);
      return cands.length > 1 ? n + 1 : n;
    }, 0);
  }, [path.hops, knownRepeaters]);

  return (
    <div className="border-t border-cs-border">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 px-1 py-2 text-left transition-colors',
          open ? 'bg-cs-bg-3' : 'hover:bg-cs-bg-3/60',
        )}
      >
        <span className="inline-flex w-3 shrink-0 text-cs-text-dim" aria-hidden>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <HopAvatar hop={lastRepeater} size={24} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-cs-text">
            {lastRepeaterLabel ?? 'Unknown repeater'}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-cs-text-dim">
            <span>{hopCount} hops</span>
            <span aria-hidden>·</span>
            <span title="Bytes of each hop's pubkey carried in the routing path">
              {path.hashMode}-byte path
            </span>
            {conflictCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5 text-cs-warn">
                  <AlertTriangle size={10} aria-hidden />
                  {conflictCount} conflict{conflictCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <SignalBars snr={path.finalSnr} />
          <span
            className="font-mono text-[10px]"
            style={{ color: `rgb(var(${snrTokenVar(path.finalSnr)}))` }}
          >
            {fmtSnr(path.finalSnr)}
          </span>
        </div>
      </button>
      {open && (
        <PathTimeline
          hops={path.hops}
          knownRepeaters={knownRepeaters}
          onHopClick={onHopClick}
          onSelectCandidate={onSelectCandidate}
        />
      )}
    </div>
  );
}

function PathTimeline({
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
        const hopIndex =
          hop.kind === 'hop' ? hops.slice(0, i).filter((h) => h.kind === 'hop').length + 1 : null;
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

function HopRow({
  hop,
  hopIndex,
  isLast,
  knownRepeaters,
  conflictOpen,
  onToggleConflict,
  onHopClick,
  onSelectCandidate,
}: {
  hop: MessageHop;
  hopIndex: number | null;
  isLast: boolean;
  knownRepeaters: Contact[];
  conflictOpen: boolean;
  onToggleConflict: () => void;
  onHopClick?: (hop: MessageHop) => void;
  onSelectCandidate?: (hop: MessageHop, contact: Contact) => void;
}) {
  const AVATAR = 28;
  const ROW_PAD = 10;
  const candidates = hop.kind === 'hop' ? candidatesFor(hop, knownRepeaters) : [];
  const hasConflict = candidates.length > 1;
  // ≥1 match → render that repeater's name. With multiple matches the row
  // still shows the conflict chip so the user can pick a different one; until
  // they do, the first match is a better guess than "Unknown".
  const resolved = candidates[0] ?? null;
  const displayName = resolved ? resolved.name : hop.unnamed ? null : (hop.name ?? null);
  const displayPk = resolved ? resolved.publicKeyHex : (hop.pk ?? null);
  const showAsUnnamed = !resolved && hop.unnamed;

  // Outer row is a <div>, not a <button>, because it contains nested buttons
  // (conflict chip + ConflictPanel candidates) and <button>-in-<button> is
  // invalid HTML. When onHopClick is provided, the div takes onClick + keyboard
  // semantics via role="button".
  const rowProps = onHopClick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: () => onHopClick(hop),
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onHopClick(hop);
          }
        },
      }
    : {};
  return (
    <div className="relative">
      <div
        {...rowProps}
        className={cn(
          'relative flex w-full gap-2.5 rounded text-left transition-colors',
          onHopClick ? 'cursor-pointer hover:bg-cs-bg-3' : '',
        )}
        style={{ padding: `${ROW_PAD}px 0` }}
      >
        {/* Vertical rail joining this avatar to the next one. zIndex sits
            BEHIND the avatar (z-0 vs z-10) so the line never paints through. */}
        {!isLast && (
          <span
            aria-hidden
            className="absolute z-0 bg-cs-border"
            style={{
              left: AVATAR / 2 - 0.5,
              top: ROW_PAD + AVATAR / 2,
              bottom: -ROW_PAD,
              width: 1,
            }}
          />
        )}
        <span className="relative z-10">
          <HopAvatar hop={hop} size={AVATAR} />
        </span>
        <div className="relative z-10 min-w-0 flex-1 pt-0.5">
          <div
            className={cn(
              'truncate text-[12.5px]',
              showAsUnnamed ? 'italic text-cs-text-dim' : 'font-medium text-cs-text',
            )}
          >
            {showAsUnnamed ? 'Unknown repeater' : (displayName ?? 'Unknown repeater')}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-cs-text-dim">
            {hop.kind === 'origin' && 'Sent the message'}
            {hop.kind === 'sink' && 'You received the message'}
            {hop.kind === 'hop' &&
              (showAsUnnamed
                ? `Hop ${hopIndex} · prefix ${hop.shortId} · no advert seen`
                : `Hop ${hopIndex} · ${displayPk ?? hop.shortId}`)}
          </div>
          {hop.kind === 'hop' && hasConflict && (
            <div className="mt-1 flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleConflict();
                }}
                aria-expanded={conflictOpen}
                aria-label={`${candidates.length} repeaters match this prefix — click to resolve`}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded border border-cs-warn/40 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-cs-warn transition-colors',
                  conflictOpen ? 'bg-cs-warn/10' : 'hover:bg-cs-warn/10',
                )}
              >
                <AlertTriangle size={9} aria-hidden />
                <span>{candidates.length} known repeaters</span>
                <span aria-hidden className="ml-0.5 inline-flex opacity-70">
                  {conflictOpen ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                </span>
              </button>
            </div>
          )}
          {hop.kind === 'hop' && hasConflict && conflictOpen && (
            <ConflictPanel
              hop={hop}
              candidates={candidates}
              onSelectCandidate={onSelectCandidate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HopAvatar({ hop, size = 28 }: { hop: MessageHop; size?: number }) {
  const cls =
    hop.kind === 'origin'
      ? 'bg-pink-600 text-white'
      : hop.kind === 'sink'
        ? 'bg-cyan-600 text-white'
        : 'bg-cs-border-strong text-cs-text';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-mono font-semibold',
        cls,
        hop.unnamed && 'border-2 border-dashed border-cs-border opacity-60',
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        letterSpacing: 0.5,
      }}
    >
      {hop.shortId.slice(0, 2)}
    </div>
  );
}

function ConflictPanel({
  hop,
  candidates,
  onSelectCandidate,
}: {
  hop: MessageHop;
  candidates: Contact[];
  onSelectCandidate?: (hop: MessageHop, contact: Contact) => void;
}) {
  return (
    <div className="mt-2 rounded border border-cs-warn/40 bg-cs-warn/5 px-2.5 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-cs-warn">
        <AlertTriangle size={11} aria-hidden />
        <span>
          Prefix <code className="rounded bg-cs-bg-3 px-1 text-cs-text">{hop.shortId}</code> matches{' '}
          {candidates.length} known repeaters
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {candidates.map((c) => {
          const lastSeenLabel = c.lastSeenMs ? formatLastSeen(c.lastSeenMs) : '—';
          const stale = c.lastSeenMs ? Date.now() - c.lastSeenMs > 7 * 24 * 3600 * 1000 : false;
          const snr = c.snr ?? null;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelectCandidate?.(hop, c)}
              className="flex items-center gap-2 rounded border border-transparent px-2 py-1 text-left text-cs-text transition-colors hover:border-cs-border hover:bg-cs-bg-2"
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  stale ? 'bg-cs-text-dim' : 'bg-cs-online',
                )}
              />
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-[12px] font-medium', stale && 'opacity-70')}>
                  {c.name}
                </div>
                <div className="mt-px flex items-center gap-1.5 font-mono text-[10px] text-cs-text-dim">
                  <span className="truncate">{c.publicKeyHex.slice(0, 16)}…</span>
                  <span aria-hidden>·</span>
                  <span>{lastSeenLabel}</span>
                </div>
              </div>
              {snr != null && (
                <span
                  className="font-mono text-[10px]"
                  style={{ color: `rgb(var(${snrTokenVar(snr)}))` }}
                >
                  {fmtSnr(snr)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-cs-text-dim">
        MeshCore identifies repeaters by the first byte(s) of their public key. Pick the one you
        believe relayed this message to pin the resolution.
      </p>
    </div>
  );
}

function SignalBars({ snr, size = 12 }: { snr: number; size?: number }) {
  const band = snrBand(snr);
  const lit = band === 'strong' ? 3 : band === 'mid' ? 2 : 1;
  const color = `rgb(var(${snrTokenVar(snr)}))`;
  const dim = 'rgb(var(--cs-border))';
  const heights = [0.4, 0.7, 1.0];
  return (
    <svg
      width={size + 4}
      height={size}
      viewBox={`0 0 ${size + 4} ${size}`}
      role="img"
      aria-label={`Signal ${fmtSnr(snr)}`}
    >
      {heights.map((h, i) => {
        const barW = 3;
        const gap = 2;
        const x = i * (barW + gap);
        const y = size - size * h;
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length 3-bar gauge
            key={i}
            x={x}
            y={y}
            width={barW}
            height={size * h}
            rx={0.5}
            fill={i < lit ? color : dim}
          />
        );
      })}
    </svg>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function snrBand(snr: number): 'strong' | 'mid' | 'weak' {
  if (snr >= 5) return 'strong';
  if (snr >= 0) return 'mid';
  return 'weak';
}

function snrTokenVar(snr: number): string {
  const b = snrBand(snr);
  if (b === 'strong') return '--cs-online';
  if (b === 'mid') return '--cs-warn';
  return '--cs-danger';
}

function fmtSnr(s: number): string {
  return `${s.toFixed(2)}dB`;
}

function candidatesFor(hop: MessageHop, knownRepeaters: Contact[]): Contact[] {
  if (hop.kind !== 'hop' || hop.shortId.length === 0) return [];
  const prefix = hop.shortId.toLowerCase();
  return knownRepeaters.filter((c) => c.publicKeyHex.toLowerCase().startsWith(prefix));
}

function formatLastSeen(ms: number): string {
  const delta = Math.max(0, Date.now() - ms);
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
