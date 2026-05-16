// Append-only, ring-bounded log of message-bearing companion frames the device
// emitted in response to a client's GET_NEXT_MSG (0x0a). Each entry has a
// monotonically increasing absolute sequence number that survives eviction —
// callers only deal in those absolute seq numbers, never array indices.

const DEFAULT_MAX_CACHE = 1024;

export interface InboxEntry {
  seq: number;
  bytes: Buffer;
}

export class InboxCache {
  private entries: InboxEntry[] = [];
  private nextSeq = 0;

  constructor(private readonly maxEntries: number = DEFAULT_MAX_CACHE) {}

  append(bytes: Buffer): InboxEntry {
    const entry: InboxEntry = { seq: this.nextSeq, bytes };
    this.nextSeq += 1;
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    return entry;
  }

  // Next seq the cache will hand out — also the cursor value meaning "all seen".
  head(): number {
    return this.nextSeq;
  }

  // First seq still in the cache. Cursors below this have been evicted.
  oldestSeq(): number {
    return this.entries.length > 0 ? this.entries[0].seq : this.nextSeq;
  }

  get(seq: number): InboxEntry | null {
    if (this.entries.length === 0) return null;
    const offset = seq - this.entries[0].seq;
    if (offset < 0 || offset >= this.entries.length) return null;
    return this.entries[offset];
  }

  size(): number {
    return this.entries.length;
  }

  reset(): void {
    this.entries = [];
    this.nextSeq = 0;
  }
}
