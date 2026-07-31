import { beforeEach, describe, expect, it } from 'vitest';
import type { CliHistoryEntry } from '@/panels/repeater-admin/cli/lib/persistence';
import {
  loadHistory,
  loadPendingReboot,
  patchLastStatus,
  pushHistory,
  saveHistory,
  savePendingReboot,
} from '@/panels/repeater-admin/cli/lib/persistence';

// A minimal in-memory Storage so the node-env test exercises the REAL path,
// not the degraded no-storage fallback.
class MemStorage implements Storage {
  private map = new Map<string, string>();

  get length() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }

  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }

  removeItem(k: string) {
    this.map.delete(k);
  }

  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const PK = 'abcdef0123456789';
let store: MemStorage;
beforeEach(() => {
  store = new MemStorage();
});

describe('history persistence', () => {
  it('round-trips oldest-first against an injected Storage', () => {
    const h: CliHistoryEntry[] = [
      { text: 'ver', status: 'ok' },
      { text: 'get radio', status: 'ok' },
    ];
    saveHistory(PK, h, store);
    expect(loadHistory(PK, store)).toEqual(h);
  });

  it('is keyed per pubkey', () => {
    saveHistory(PK, [{ text: 'ver', status: 'ok' }], store);
    expect(loadHistory('other', store)).toEqual([]);
  });

  it('returns [] for absent or corrupt storage entries', () => {
    expect(loadHistory(PK, store)).toEqual([]);
    store.setItem(`coresense.cli.history.${PK}`, '{not json');
    expect(loadHistory(PK, store)).toEqual([]);
  });
});

describe('pushHistory', () => {
  it('appends at the end (oldest-first)', () => {
    const h = pushHistory([{ text: 'ver', status: 'ok' }], { text: 'board', status: 'ok' });
    expect(h.map((e) => e.text)).toEqual(['ver', 'board']);
  });

  it('collapses a consecutive duplicate rather than adding a second row', () => {
    const h = pushHistory([{ text: 'ver', status: 'ok' }], { text: 'ver', status: 'error' });
    expect(h).toEqual([{ text: 'ver', status: 'error' }]);
  });

  it('trims from the front at the 200 cap', () => {
    let h: CliHistoryEntry[] = [];
    for (let i = 0; i < 205; i++) h = pushHistory(h, { text: `c${i}`, status: 'ok' });
    expect(h.length).toBe(200);
    expect(h[0].text).toBe('c5'); // the five oldest were trimmed
    expect(h[199].text).toBe('c204');
  });
});

describe('patchLastStatus', () => {
  it('patches the newest entry, leaving the rest', () => {
    const h = patchLastStatus(
      [
        { text: 'a', status: 'sent' },
        { text: 'b', status: 'sent' },
      ],
      'ok',
    );
    expect(h).toEqual([
      { text: 'a', status: 'sent' },
      { text: 'b', status: 'ok' },
    ]);
  });

  it('is a no-op on an empty history', () => {
    expect(patchLastStatus([], 'ok')).toEqual([]);
  });
});

describe('reboot-pending persistence', () => {
  it('defaults to an empty, non-dismissed, not-rebooting state', () => {
    expect(loadPendingReboot(PK, store)).toEqual({ settings: [], dismissed: false, rebootSentAtMs: null });
  });

  it('round-trips', () => {
    const p = { settings: [{ label: 'radio', verify: 'get radio' }], dismissed: true, rebootSentAtMs: 123 };
    savePendingReboot(PK, p, store);
    expect(loadPendingReboot(PK, store)).toEqual(p);
  });
});

describe('degraded storage', () => {
  it('a throwing Storage degrades to session-only rather than crashing', () => {
    const boom: Storage = {
      length: 0,
      clear() {},
      key() {
        return null;
      },
      getItem() {
        throw new Error('nope');
      },
      setItem() {
        throw new Error('nope');
      },
      removeItem() {},
    };
    expect(loadHistory(PK, boom)).toEqual([]);
    expect(() => saveHistory(PK, [{ text: 'ver', status: 'ok' }], boom)).not.toThrow();
    expect(loadPendingReboot(PK, boom)).toEqual({
      settings: [],
      dismissed: false,
      rebootSentAtMs: null,
    });
  });
});
