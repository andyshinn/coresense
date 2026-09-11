import { describe, expect, it } from 'vitest';
import { previewEngine, renderPreview } from '@/panels/macros/lib/preview';
import { replyContext, sendContext, worstCaseContext } from '@/panels/macros/lib/sampleContext';
import { MACRO_VARIABLES } from '../../../../../src/shared/macros';

const NEVER_POPULATED = MACRO_VARIABLES.filter((v) => v.populated === false).map((v) => v.name);
const REPLY_ONLY = MACRO_VARIABLES.filter((v) => v.available === 'reply').map((v) => v.name);
// The always-available variables that a real context can actually fill. The
// never-populated ones are nominally 'always' too, which is exactly what let
// {{ peer_rssi }} preview as -80 in both modes.
const ALWAYS = MACRO_VARIABLES.filter((v) => v.available === 'always' && v.populated !== false).map((v) => v.name);

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

  // A preview pane exists to answer "what will this transmit?". buildSampleContext
  // gives peer_rssi / peer_snr / rssi plausible numbers because the lint root and
  // validateTemplate need a complete shape — but nothing populates them on a real
  // send, so the preview has to blank them or it invites macros that go out as
  // "?dBm". peer_rssi and peer_snr are declared 'always', so nulling reply-only
  // variables was never enough to catch them: they survived into BOTH modes.
  describe('never-populated variables are blanked in every preview', () => {
    it('has something to check', () => {
      expect(NEVER_POPULATED).toEqual(expect.arrayContaining(['peer_rssi', 'peer_snr']));
    });

    it.each([
      ['reply', replyContext],
      ['send', sendContext],
      ['worst case', worstCaseContext],
    ])('%s context nulls them', (_label, build) => {
      const ctx = build() as unknown as Record<string, unknown>;
      for (const name of NEVER_POPULATED) expect(ctx[name], `${name} should be blank`).toBeNull();
    });

    it('renders them through the real preview path as the ? placeholder, in both modes', () => {
      const engine = previewEngine('metric');
      for (const ctx of [replyContext(), sendContext()]) {
        expect(renderPreview(engine, 'Heard you at {{ peer_rssi }}dBm', ctx).text).toBe('Heard you at ?dBm');
        expect(renderPreview(engine, '{{ peer_snr }}dB', ctx).text).toBe('?dB');
      }
    });

    it('leaves the peer variables that do resolve alone', () => {
      const ctx = sendContext() as unknown as Record<string, unknown>;
      expect(ctx.peer_hops).not.toBeNull();
      expect(ctx.peer_last_seen).not.toBeNull();
      expect(ctx.peer_pos).not.toBeNull();
    });
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
