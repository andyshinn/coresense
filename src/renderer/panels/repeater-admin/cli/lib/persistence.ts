// Per-repeater history ring and reboot-pending, keyed by contact.publicKeyHex —
// named explicitly because "pubkey" is ambiguous (Contact.key 'c:<hex>', the
// library's 12-char prefix, or the full hex), and CliTab and RebootPending
// picking differently would silently split the two stores.
//
// `storage` is injectable and defaults to globalThis.localStorage. The unit
// project runs in environment:'node' with no localStorage, so a test that did
// not inject a fake would silently exercise only the degraded path and pass.

export interface CliHistoryEntry {
  text: string;
  status: 'ok' | 'error' | 'timeout' | 'sent';
}

export interface RebootPending {
  settings: { label: string; verify: string | null }[];
  dismissed: boolean;
  rebootSentAtMs: number | null; // persisted, unlike the mockup's transient flag
}

export const HISTORY_CAP = 200;

const historyKey = (pk: string) => `coresense.cli.history.${pk}`;
const rebootKey = (pk: string) => `coresense.cli.pendingReboot.${pk}`;
const DEFAULT_REBOOT: RebootPending = { settings: [], dismissed: false, rebootSentAtMs: null };

function resolveStorage(storage?: Storage): Storage | null {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadHistory(pubkeyHex: string, storage?: Storage): CliHistoryEntry[] {
  const s = resolveStorage(storage);
  if (!s) return [];
  try {
    const raw = s.getItem(historyKey(pubkeyHex));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CliHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(pubkeyHex: string, h: CliHistoryEntry[], storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(historyKey(pubkeyHex), JSON.stringify(h.slice(-HISTORY_CAP)));
  } catch {
    // degrade to session-only
  }
}

export function loadPendingReboot(pubkeyHex: string, storage?: Storage): RebootPending {
  const s = resolveStorage(storage);
  if (!s) return { ...DEFAULT_REBOOT };
  try {
    const raw = s.getItem(rebootKey(pubkeyHex));
    if (!raw) return { ...DEFAULT_REBOOT };
    const p = JSON.parse(raw) as Partial<RebootPending>;
    return {
      settings: Array.isArray(p.settings) ? p.settings : [],
      dismissed: !!p.dismissed,
      rebootSentAtMs: typeof p.rebootSentAtMs === 'number' ? p.rebootSentAtMs : null,
    };
  } catch {
    return { ...DEFAULT_REBOOT };
  }
}

export function savePendingReboot(pubkeyHex: string, p: RebootPending, storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(rebootKey(pubkeyHex), JSON.stringify(p));
  } catch {
    // degrade to session-only
  }
}

/** Push on submit (so ↑ recalls what you just ran). Consecutive duplicates
 *  collapse; the 200-entry cap trims from the front. Oldest-first. */
export function pushHistory(h: CliHistoryEntry[], entry: CliHistoryEntry): CliHistoryEntry[] {
  const last = h[h.length - 1];
  const next = last && last.text === entry.text ? [...h.slice(0, -1), entry] : [...h, entry];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

/** Patch the newest entry's status — the settle half of push-on-submit. */
export function patchLastStatus(h: CliHistoryEntry[], status: CliHistoryEntry['status']): CliHistoryEntry[] {
  if (h.length === 0) return h;
  return [...h.slice(0, -1), { ...h[h.length - 1], status }];
}
