// Notification tuning constants. See docs/superpowers/specs/2026-07-06-notification-improvements-design.md.
export const STALE_THRESHOLD_MS = 5 * 60_000; // older than this ⇒ "backlog"
export const SUMMARY_FLUSH_MS = 1_000; // debounce before posting/refreshing a summary
export const ROLLUP_CAP = 5; // > this many summarized conversations ⇒ one global summary
export const MAX_BODY = 240; // notification body truncation length
export const DELIMITER = '—'; // channel/sender separator when subtitle is unavailable
export const MENTION_SUFFIX = '• mention';
export const MAX_NOTIFIED_IDS = 500; // dedup ring size
