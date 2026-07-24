import { describe, expect, it } from 'vitest';
import { replyContext, sendContext, worstCaseContext } from '@/panels/macros/lib/sampleContext';
import { MACRO_VARIABLES } from '../../../../../src/shared/macros';

const REPLY_ONLY = MACRO_VARIABLES.filter((v) => v.available === 'reply').map((v) => v.name);
const ALWAYS = MACRO_VARIABLES.filter((v) => v.available === 'always').map((v) => v.name);

describe('sample contexts', () => {
  it('reply context populates the reply-only variables', () => {
    const ctx = replyContext() as unknown as Record<string, unknown>;
    expect(ctx.sender_name).toBeTruthy();
    expect(ctx.snr).not.toBeNull();
  });

  it('send context nulls every reply-only variable but keeps the always ones', () => {
    const ctx = sendContext() as unknown as Record<string, unknown>;
    for (const name of REPLY_ONLY) {
      if (name === 'paths') expect(ctx[name]).toEqual([]);
      else expect(ctx[name]).toBeNull();
    }
    for (const name of ALWAYS) expect(ctx[name]).not.toBeNull();
  });

  it('worst-case context is fully populated and longer than the reply sample', () => {
    const worst = worstCaseContext() as unknown as Record<string, unknown>;
    const reply = replyContext() as unknown as Record<string, unknown>;
    for (const name of [...ALWAYS, ...REPLY_ONLY]) expect(worst[name]).not.toBeUndefined();
    expect(String(worst.peer_name).length).toBeGreaterThan(String(reply.peer_name).length);
  });

  it('sample paths expose relay hops with pk, and a full all_hops timeline', () => {
    for (const ctx of [replyContext(), worstCaseContext()]) {
      const path = ctx.paths[0];
      expect(path.hops.length).toBeGreaterThan(0);
      expect(path.length).toBe(path.hops.length);
      for (const hop of path.hops) {
        expect(hop.kind).toBe('hop');
        expect(hop.short_id).toBeTruthy();
      }
      expect(path.all_hops[0].kind).toBe('origin');
      expect(path.all_hops[path.all_hops.length - 1].kind).toBe('sink');
      expect(path.all_hops.length).toBe(path.hops.length + 2);
    }
  });

  it('reply sample has one resolved and one unresolved relay hop', () => {
    const hops = replyContext().paths[0].hops;
    expect(hops.some((h) => h.pk !== null)).toBe(true);
    expect(hops.some((h) => h.pk === null)).toBe(true);
  });
});
