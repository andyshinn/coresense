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
      if (now() - msg.ts <= config.staleThresholdMs) {
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
