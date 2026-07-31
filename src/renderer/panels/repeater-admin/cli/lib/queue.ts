// Client-side FIFO in front of a library that allows exactly one outstanding
// CLI command per repeater. Pure and serialisable — the AbortController lives in
// a ref in CliTab (Phase 3), never in this state.
import type { CliCommand } from '../../../../../shared/repeater-cli/catalog';

export type CliEntryState = 'queued' | 'sending' | 'ok' | 'error' | 'timeout' | 'sent' | 'cancelled';

export interface CliEntry {
  id: string;
  text: string; // exactly what goes on the air
  cmd: CliCommand | null; // resolved catalog entry, null if unknown
  state: CliEntryState;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  reply: string | null;
  error: { kind: 'refused' | 'timeout' | 'transport' | 'superseded'; message: string } | null;
}

export interface CliQueueState {
  entries: CliEntry[];
}

const TERMINAL = new Set<CliEntryState>(['ok', 'error', 'timeout', 'sent', 'cancelled']);

export function enqueue(s: CliQueueState, e: CliEntry): CliQueueState {
  return { entries: [...s.entries, e] };
}

/** Promote the earliest queued entry to `sending`, unless one is already
 *  sending — the invariant that keeps the library from ever seeing two
 *  outstanding commands. */
export function beginNext(s: CliQueueState): { state: CliQueueState; next: CliEntry | null } {
  if (s.entries.some((e) => e.state === 'sending')) return { state: s, next: null };
  const idx = s.entries.findIndex((e) => e.state === 'queued');
  if (idx === -1) return { state: s, next: null };
  const next: CliEntry = { ...s.entries[idx], state: 'sending', startedAt: Date.now() };
  return { state: { entries: s.entries.map((e, i) => (i === idx ? next : e)) }, next };
}

export function settle(s: CliQueueState, id: string, patch: Partial<CliEntry>): CliQueueState {
  return { entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Move a QUEUED entry to cancelled. A sending entry is left alone — use
 *  abortAll for that. */
export function cancel(s: CliQueueState, id: string): CliQueueState {
  return {
    entries: s.entries.map((e) =>
      e.id === id && e.state === 'queued' ? { ...e, state: 'cancelled', endedAt: Date.now() } : e,
    ),
  };
}

/** Move EVERY non-terminal entry, including the sending one, to cancelled.
 *  Leaving an aborted entry in `sending` would make beginNext return null
 *  forever and wedge the queue — the exact failure this change removes. */
export function abortAll(s: CliQueueState): CliQueueState {
  return {
    entries: s.entries.map((e) =>
      TERMINAL.has(e.state)
        ? e
        : { ...e, state: 'cancelled', endedAt: Date.now(), error: { kind: 'transport', message: 'aborted' } },
    ),
  };
}

/** The history status for an entry, or null when it must not be recorded. A
 *  cancelled entry stays in the transcript and is NOT added to history (§2.5). */
export function historyStatusFor(e: CliEntry): 'ok' | 'error' | 'timeout' | 'sent' | null {
  switch (e.state) {
    case 'ok':
    case 'error':
    case 'timeout':
    case 'sent':
      return e.state;
    default:
      return null;
  }
}
