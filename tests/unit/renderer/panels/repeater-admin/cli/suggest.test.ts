import { describe, expect, it } from 'vitest';
import type { CliParse } from '@/panels/repeater-admin/cli/lib/parse';
import type { CliSuggestCtx, CliSuggestion } from '@/panels/repeater-admin/cli/lib/suggest';
import {
  applySuggestion,
  deriveRecent,
  extractNodeValue,
  groupSuggestions,
  orderedSuggestions,
  suggest,
} from '@/panels/repeater-admin/cli/lib/suggest';
import { CLI_BY_NAME, type CliCommand } from '../../../../../../src/shared/repeater-cli/catalog';

const ctx = (over: Partial<CliSuggestCtx> = {}): CliSuggestCtx => ({ recent: [], nodeValues: {}, ...over });

describe('suggest — command mode', () => {
  it('ranks a recent command above an equal-scoring peer', () => {
    const { items } = suggest('', 0, ctx({ recent: ['set dutycycle'] }));
    expect(items[0].label).toBe('set dutycycle');
    expect(items[0].recent).toBe(true);
  });

  it('sinks serial-only commands to the bottom regardless of match', () => {
    const { items } = suggest('get acl', 7, ctx());
    // 'get acl' is a perfect prefix match but serialOnly (−2000), so anything
    // else that matches outranks it; and it is flagged serialOnly.
    const acl = items.find((i) => i.label === 'get acl');
    expect(acl?.serialOnly).toBe(true);
    expect(items[items.length - 1].label).toBe('get acl');
  });

  it('inserts a trailing space only for commands that take arguments', () => {
    const { items } = suggest('set radio', 9, ctx());
    expect(items.find((i) => i.label === 'set radio')?.insert).toBe('set radio ');
    expect(CLI_BY_NAME.ver && suggest('ver', 3, ctx()).items.find((i) => i.label === 'ver')?.insert).toBe('ver');
  });

  it('does not flag recent when the query is non-empty', () => {
    const { items } = suggest('set du', 6, ctx({ recent: ['set dutycycle'] }));
    const top = items.find((i) => i.label === 'set dutycycle');
    expect(top?.recent).toBeUndefined();
  });
});

describe('suggest — arg mode', () => {
  it('offers enum values filtered by prefix', () => {
    const { items } = suggest('set repeat o', 12, ctx());
    expect(items.map((i) => i.label)).toEqual(['on', 'off']);
    const { items: onlyOff } = suggest('set repeat of', 13, ctx());
    expect(onlyOff.map((i) => i.label)).toEqual(['off']);
  });

  it('offers "on node now" only at argIndex 0 and not when it duplicates an enum', () => {
    // set adc.multiplier has no enum → node value offered at index 0.
    const at0 = suggest('set adc.multiplier ', 19, ctx({ nodeValues: { 'adc.multiplier': '1.87' } }));
    expect(at0.items[0]).toMatchObject({ label: '1.87', kind: 'current', meta: 'on node now' });
    // set repeat's node value 'on' IS an enum value → not offered as a separate row.
    const dup = suggest('set repeat ', 11, ctx({ nodeValues: { repeat: 'on' } }));
    expect(dup.items.filter((i) => i.meta === 'on node now')).toHaveLength(0);
    // ...but the matching enum row is marked current.
    expect(dup.items.find((i) => i.label === 'on')?.meta).toBe('current');
  });

  it('matches presets on value-prefix OR label-substring', () => {
    // 'us' has no value starting with it, but the 'US 915' label contains it.
    const { items } = suggest('set radio us', 12, ctx());
    expect(items.map((i) => i.label)).toContain('910.525,250,11,5');
  });
});

describe('groupSuggestions / orderedSuggestions — display order', () => {
  const commandParse: CliParse = { mode: 'command', token: 's', start: 0 };
  const sug = (label: string, group: CliCommand['group'], over: Partial<CliSuggestion> = {}): CliSuggestion => ({
    id: `c:${label}`,
    label,
    desc: '',
    kind: 'command',
    group,
    insert: label,
    replaceFrom: 0,
    ...over,
  });

  it('clusters interleaved groups by first appearance — display order ≠ raw ranked order', () => {
    // Raw ranked order interleaves Radio/System; the palette clusters them, so
    // navigating the raw list would "jump" between sections. This is the bug.
    const raw = [sug('a', 'Radio'), sug('b', 'System'), sug('c', 'Radio'), sug('d', 'System')];
    expect(orderedSuggestions(commandParse, raw).map((i) => i.label)).toEqual(['a', 'c', 'b', 'd']);
    expect(groupSuggestions(commandParse, raw).map((g) => g.name)).toEqual(['Radio', 'System']);
  });

  it('puts Recent first and sinks serial-only into a trailing group', () => {
    const raw = [sug('r', 'Radio', { recent: true }), sug('n', 'System'), sug('e', 'System', { serialOnly: true })];
    expect(groupSuggestions(commandParse, raw).map((g) => g.name)).toEqual([
      'Recent on this node',
      'System',
      'Not available over radio',
    ]);
    expect(orderedSuggestions(commandParse, raw).map((i) => i.label)).toEqual(['r', 'n', 'e']);
  });

  it('leaves argument mode a single ungrouped list in its original order', () => {
    const { parse, items } = suggest('set repeat o', 12, ctx());
    expect(parse.mode).toBe('arg');
    expect(orderedSuggestions(parse, items)).toEqual(items);
  });

  it('is a permutation of the raw list — real suggest() output, nothing dropped or duplicated', () => {
    const { parse, items } = suggest('s', 1, ctx());
    const ordered = orderedSuggestions(parse, items);
    expect(ordered).toHaveLength(items.length);
    expect(new Set(ordered.map((i) => i.id))).toEqual(new Set(items.map((i) => i.id)));
    // Contiguity: once display order leaves a section it never returns to it.
    const sectionOf = (i: CliSuggestion) => (i.serialOnly ? ' serial' : i.recent ? ' recent' : (i.group ?? 'Info'));
    const seen = new Set<string>();
    let prev = '';
    for (const i of ordered) {
      const s = sectionOf(i);
      if (s !== prev) {
        expect(seen.has(s)).toBe(false);
        seen.add(s);
        prev = s;
      }
    }
  });
});

describe('applySuggestion', () => {
  it('replaces the whole line for a command (replaceAll) and puts the caret at the end', () => {
    const s = suggest('set ra', 6, ctx()).items.find((i) => i.label === 'set radio');
    const out = applySuggestion('set ra', 6, s as never);
    expect(out).toEqual({ value: 'set radio ', caret: 10 });
  });

  it('splices an arg value at replaceFrom, keeping the tail', () => {
    const s = suggest('set repeat o', 12, ctx()).items.find((i) => i.label === 'on');
    const out = applySuggestion('set repeat o', 12, s as never);
    expect(out).toEqual({ value: 'set repeat on', caret: 13 });
  });
});

describe('extractNodeValue', () => {
  it('strips the firmware "> " prefix via replyValue', () => {
    expect(extractNodeValue(CLI_BY_NAME['get radio'], '> 869.525,250,11,5')).toBe('869.525,250,11,5');
  });

  it('records nothing when extraction is ambiguous (a colon or multiple lines)', () => {
    // get role HAS replyValue (> " strip), so this tests the regex branch, not the fallback.
    expect(extractNodeValue(CLI_BY_NAME['get role'], '> repeater')).toBe('repeater');
    // A command with no key never records.
    expect(extractNodeValue(CLI_BY_NAME.ver, '1.14.3')).toBeNull();
  });

  it('falls back to single-line/no-colon extraction when a keyed command has no replyValue', () => {
    const noReplyValue = { name: 'x', group: 'System', desc: '', key: 'x' } as unknown as CliCommand;
    // success: single line, no colon
    expect(extractNodeValue(noReplyValue, '  on  ')).toBe('on');
    // failure → null: a colon, or multiple lines, records nothing
    expect(extractNodeValue(noReplyValue, 'lat: 30.2')).toBeNull();
    expect(extractNodeValue(noReplyValue, 'line1\nline2')).toBeNull();
  });
});

describe('deriveRecent', () => {
  it('resolves ok history lines to distinct command names, newest first, max 5', () => {
    const recent = deriveRecent([
      { text: 'ver', status: 'ok' },
      { text: 'get radio', status: 'error' }, // non-ok skipped
      { text: 'set radio 869.525,250,11,5', status: 'ok' },
      { text: 'set radio 910.525,250,11,5', status: 'ok' }, // same command, collapsed
    ]);
    expect(recent).toEqual(['set radio', 'ver']);
  });
});
