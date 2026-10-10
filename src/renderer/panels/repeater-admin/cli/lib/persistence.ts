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
  /** Stable per-submit id, mirrored from the queue entry (`CliEntry.id`) so a
   *  settle patches exactly the line that submit created — not the newest line
   *  that happens to share this text. Optional: entries persisted before this
   *  field, and consecutive-duplicate collapses that drop the earlier line,
   *  simply carry no id. */
  id?: string;
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

/** The parsed JSON at `key`, or undefined when storage is unavailable, the key
 *  is absent, or reading/parsing throws. */
function readJson(key: string, storage?: Storage): unknown {
  const s = resolveStorage(storage);
  if (!s) return undefined;
  try {
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown, storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    // degrade to session-only
  }
}

const HISTORY_STATUSES: readonly CliHistoryEntry['status'][] = ['ok', 'error', 'timeout', 'sent'];

// Element guards for what comes back out of storage: a malformed history line
// would otherwise crash reverse-search (`text.toLowerCase()`) and the status
// glyph lookup, and a malformed setting the reboot strip.
function isHistoryEntry(v: unknown): v is CliHistoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.text === 'string' &&
    HISTORY_STATUSES.includes(e.status as CliHistoryEntry['status']) &&
    (e.id === undefined || typeof e.id === 'string')
  );
}

function isRebootSetting(v: unknown): v is RebootPending['settings'][number] {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return typeof e.label === 'string' && (e.verify === null || typeof e.verify === 'string');
}

export function loadHistory(pubkeyHex: string, storage?: Storage): CliHistoryEntry[] {
  const parsed = readJson(historyKey(pubkeyHex), storage);
  return Array.isArray(parsed) ? parsed.filter(isHistoryEntry) : [];
}

export function saveHistory(pubkeyHex: string, h: CliHistoryEntry[], storage?: Storage): void {
  writeJson(historyKey(pubkeyHex), h.slice(-HISTORY_CAP), storage);
}

export function loadPendingReboot(pubkeyHex: string, storage?: Storage): RebootPending {
  const parsed = readJson(rebootKey(pubkeyHex), storage);
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_REBOOT };
  const p = parsed as Partial<Record<keyof RebootPending, unknown>>;
  return {
    settings: Array.isArray(p.settings) ? p.settings.filter(isRebootSetting) : [],
    dismissed: !!p.dismissed,
    rebootSentAtMs: typeof p.rebootSentAtMs === 'number' ? p.rebootSentAtMs : null,
  };
}

export function savePendingReboot(pubkeyHex: string, p: RebootPending, storage?: Storage): void {
  writeJson(rebootKey(pubkeyHex), p, storage);
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

/** Patch a specific entry's status by its stable id (the queue-entry id).
 *  Correlating by id, not text, keeps a command that appears more than once in
 *  history from cross-patching — two `get freq` lines settle independently
 *  instead of both landing on the newest occurrence. Returns the same array
 *  reference (a no-op the caller can skip persisting) when no entry carries the
 *  id: a consecutive-duplicate collapse dropped that line, or it aged out of
 *  the ring. */
export function patchStatusById(h: CliHistoryEntry[], id: string, status: CliHistoryEntry['status']): CliHistoryEntry[] {
  const at = h.findIndex((e) => e.id === id);
  if (at === -1) return h;
  return h.map((e, i) => (i === at ? { ...e, status } : e));
}
