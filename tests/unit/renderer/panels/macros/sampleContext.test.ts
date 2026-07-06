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

  it('path hops never carry pk, so preview matches live (pk is always null on the wire)', () => {
    for (const ctx of [replyContext(), worstCaseContext()]) {
      const hops = ctx.paths[0].hops;
      expect(hops.length).toBeGreaterThan(0);
      for (const hop of hops) {
        expect((hop as unknown as Record<string, unknown>).pk).toBeUndefined();
        expect(hop.short_id).toBeTruthy();
      }
    }
  });
});
