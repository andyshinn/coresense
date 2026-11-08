import type { Message } from '../../shared/types';

export interface StaleDescriptor {
  key: string;
  count: number;
  senders: string[];
  lastTs: number;
}

export interface AggregatorConfig {
  staleThresholdMs: number;
  flushDelayMs: number;
  rollupCap: number;
}

export interface AggregatorCallbacks {
  onIndividual(msg: Message): void;
  onSummaries(summaries: StaleDescriptor[]): void;
  onGlobalSummary(info: { total: number; conversationCount: number; lastKey: string }): void;
}

export interface Aggregator {
  ingest(msg: Message, senderName: string): void;
  clear(key: string): void;
  reset(): void;
}

interface Entry {
  count: number;
  senders: Set<string>;
  lastTs: number;
}

/** A sender clock this far AHEAD of our receive time is skewed, not early. */
export const SENT_TS_FUTURE_SLACK_MS = 60_000;
/** A deliberately generous backlog ceiling: a sender clock further behind our
 *  receive time than this is read as an unset/drifted RTC (1970 is the
 *  classic) rather than a message that waited that long on the radio. */
export const SENT_TS_MAX_BACKLOG_MS = 7 * 24 * 60 * 60_000;

/** The time to judge a message's staleness by. A backlog drained on reconnect
 *  only looks old by the packet's own timestamp (`ts` is when we pulled it),
 *  but that timestamp is the sender's clock, so it is believed only inside a
 *  plausible window around `ts`. Outside it — a fast clock would make every
 *  message "fresh", a 1970 clock every message "stale" — fall back to `ts`.
 *  The cost: a backlog from a badly skewed node notifies per message. Fixing
 *  that needs a drain signal from meshcore-ts, which it does not expose. */
export function stalenessTs(msg: Pick<Message, 'ts' | 'sentTs'>): number {
  const { ts, sentTs } = msg;
  if (sentTs == null) return ts;
  if (sentTs > ts + SENT_TS_FUTURE_SLACK_MS || sentTs < ts - SENT_TS_MAX_BACKLOG_MS) return ts;
  return sentTs;
}

export function createAggregator(deps: {
  now(): number;
  config: AggregatorConfig;
  callbacks: AggregatorCallbacks;
}): Aggregator {
  const { now, config, callbacks } = deps;
  const entries = new Map<string, Entry>();
  let lastKey = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, config.flushDelayMs);
  }

  function flush(): void {
    timer = null;
    if (entries.size === 0) return;
    if (entries.size <= config.rollupCap) {
      const summaries: StaleDescriptor[] = [];
      for (const [key, e] of entries) {
        summaries.push({ key, count: e.count, senders: [...e.senders], lastTs: e.lastTs });
      }
      callbacks.onSummaries(summaries);
      return;
    }
    let total = 0;
    for (const e of entries.values()) total += e.count;
    callbacks.onGlobalSummary({ total, conversationCount: entries.size, lastKey });
  }

  return {
    ingest(msg, senderName) {
      if (now() - stalenessTs(msg) <= config.staleThresholdMs) {
        callbacks.onIndividual(msg);
        return;
      }
      const entry = entries.get(msg.key) ?? { count: 0, senders: new Set<string>(), lastTs: 0 };
      entry.count += 1;
      if (senderName) entry.senders.add(senderName);
      entry.lastTs = Math.max(entry.lastTs, msg.ts);
      entries.set(msg.key, entry);
      lastKey = msg.key;
      scheduleFlush();
    },
    clear(key) {
      entries.delete(key);
    },
    reset() {
      entries.clear();
      lastKey = '';
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
