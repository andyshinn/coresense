import { bus } from '../events/bus';
import { coalesce } from '../events/coalesce';

/** How long to collect badge-affecting changes before recomputing. */
const BADGE_RECOMPUTE_INTERVAL_MS = 250;

export interface BadgeRecomputer {
  recomputeBadge(): void;
}

export interface BadgeSubscription {
  /** Run a pending recompute now (tests; also useful before quitting). */
  flush(): Promise<void>;
  /** Unsubscribe and drop anything pending. */
  stop(): void;
}

/** Wire the dock-badge recompute to the events that can change it.
 *
 *  Coalesced because `contacts` fires once per contact during a GET_CONTACTS
 *  sync, and one recompute walks every channel + contact key reading up to 200
 *  messages each — so an uncoalesced sync spends seconds recomputing a count
 *  that is only observable once it settles. */
export function subscribeBadgeRecompute(
  router: BadgeRecomputer,
  intervalMs: number = BADGE_RECOMPUTE_INTERVAL_MS,
): BadgeSubscription {
  const recompute = coalesce(() => router.recomputeBadge(), intervalMs);
  const onChange = () => recompute.schedule();

  bus.on('appSettings', onChange);
  bus.on('channels', onChange);
  bus.on('contacts', onChange);
  bus.on('blockRules', onChange);

  return {
    flush: () => recompute.flush(),
    stop() {
      bus.off('appSettings', onChange);
      bus.off('channels', onChange);
      bus.off('contacts', onChange);
      bus.off('blockRules', onChange);
      recompute.cancel();
    },
  };
}
