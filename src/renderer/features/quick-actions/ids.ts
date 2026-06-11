// Canonical catalog of assignable owner-card quick actions. Kept import-free
// (no store/api/react) so it stays pure and unit-testable, and so the persisted
// settings type can reference QuickActionId without a dependency cycle.
export const QUICK_ACTION_IDS = [
  'flood',
  'direct',
  'gps',
  'shareLoc',
  'copyKey',
  'reboot',
  'disconnect',
] as const;

export type QuickActionId = (typeof QUICK_ACTION_IDS)[number];

/** Owner-card default: primary flood advert + GPS / share-loc toggles + disconnect. */
export const DEFAULT_QUICK_ACTION_IDS: QuickActionId[] = ['flood', 'gps', 'shareLoc', 'disconnect'];

export const MAX_QUICK_ACTIONS = 4;
