import { describe, expect, it } from 'vitest';

import { commonPrefix, matchCommand } from '@/panels/repeater-admin/cli/lib/match';
import { CLI_BY_NAME } from '../../../../../../src/shared/repeater-cli/catalog';

const setRadio = CLI_BY_NAME['set radio'];
const setDutycycle = CLI_BY_NAME['set dutycycle'];
const setAdc = CLI_BY_NAME['set adc.multiplier']; // desc: 'Fine-tune the battery reading'

describe('matchCommand', () => {
  it('scores an empty query as 1 with no ranges (⌃Space browse)', () => {
    expect(matchCommand('', setRadio)).toEqual({ score: 1, ranges: [] });
  });

  it('scores a prefix hit as 1000 − name.length', () => {
    expect(matchCommand('set r', setRadio)).toEqual({ score: 1000 - 'set radio'.length, ranges: [[0, 5]] });
  });

  it('scores a word-start hit (after space/./-) as 700 − name.length', () => {
    const m = matchCommand('radio', setRadio);
    expect(m).toEqual({ score: 700 - 'set radio'.length, ranges: [[4, 9]] });
  });

  it('scores a mid-substring hit as 450 − name.length', () => {
    const m = matchCommand('ycle', setDutycycle);
    expect((m as { score: number }).score).toBe(450 - 'set dutycycle'.length);
  });

  it('scores a subsequence hit as 300 − name.length with merged ranges', () => {
    // 'sr' hits s(0) and r(4) of 'set radio' — two non-adjacent ranges.
    const m = matchCommand('sr', setRadio);
    expect((m as { score: number }).score).toBe(300 - 'set radio'.length);
    expect((m as { ranges: [number, number][] }).ranges).toEqual([
      [0, 1],
      [4, 5],
    ]);
  });

  it('merges adjacent subsequence ranges into one span', () => {
    // 'setr' hits s,e,t,r → [0..3] merges, then r at 4 → [[0,3],[4,5]].
    const m = matchCommand('setr', setRadio);
    expect((m as { ranges: [number, number][] }).ranges).toEqual([
      [0, 3],
      [4, 5],
    ]);
  });

  it('scores a description-only hit as 120 − name.length with no ranges', () => {
    const m = matchCommand('battery', setAdc);
    expect(m).toEqual({ score: 120 - 'set adc.multiplier'.length, ranges: [] });
  });

  it('returns null when nothing matches', () => {
    expect(matchCommand('zzzz', setRadio)).toBeNull();
  });

  it('breaks prefix ties by name length — the shorter name scores higher', () => {
    const a = matchCommand('set r', CLI_BY_NAME['set radio']); // len 9
    const b = matchCommand('set r', CLI_BY_NAME['set rxdelay']); // len 11
    expect((a as { score: number }).score).toBeGreaterThan((b as { score: number }).score);
  });

  it('is stable: sorting equal-score matches preserves input order', () => {
    // Every command ties at score 1 for the empty query; Array.sort is stable.
    const cmds = [CLI_BY_NAME.ver, CLI_BY_NAME.board, CLI_BY_NAME['get role']];
    const sorted = [...cmds].sort(
      (x, y) => (matchCommand('', y) as { score: number }).score - (matchCommand('', x) as { score: number }).score,
    );
    expect(sorted.map((c) => c.name)).toEqual(['ver', 'board', 'get role']);
  });
});

describe('commonPrefix', () => {
  it('returns the longest shared case-insensitive prefix', () => {
    expect(commonPrefix([{ label: 'set radio' }, { label: 'set radio.rxgain' }])).toBe('set radio');
  });

  it('returns null when the set diverges at character zero', () => {
    expect(commonPrefix([{ label: 'ver' }, { label: 'board' }])).toBeNull();
  });

  it('is computed over non-serialOnly items only', () => {
    // The serial-only outlier shares no prefix; without filtering it would
    // collapse the result to null and Tab would do nothing.
    const items = [{ label: 'set radio' }, { label: 'set radio.rxgain' }, { label: 'get acl', serialOnly: true as const }];
    expect(commonPrefix(items)).toBe('set radio');
  });

  it('returns null for an empty (or all-serial) set', () => {
    expect(commonPrefix([])).toBeNull();
    expect(commonPrefix([{ label: 'get acl', serialOnly: true as const }])).toBeNull();
  });
});
