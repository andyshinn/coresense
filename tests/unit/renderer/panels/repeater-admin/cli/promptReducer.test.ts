import { describe, expect, it } from 'vitest';
import type { CliPromptAction, CliPromptState } from '@/panels/repeater-admin/cli/lib/promptReducer';
import {
  cliPromptReducer,
  ghostSuffix,
  initialPromptState,
  isPaletteOpen,
  paletteItems,
  rsearchView,
} from '@/panels/repeater-admin/cli/lib/promptReducer';
import { orderedSuggestions, suggest } from '@/panels/repeater-admin/cli/lib/suggest';

// Fold a sequence of actions, returning the final state and the LAST effect.
function run(start: CliPromptState, ...actions: CliPromptAction[]) {
  let state = start;
  let effect: ReturnType<typeof cliPromptReducer>['effect'];
  for (const a of actions) {
    const r = cliPromptReducer(state, a);
    state = r.state;
    effect = r.effect;
  }
  return { state, effect };
}

const withHistory = (texts: string[]): CliPromptState => ({
  ...initialPromptState(),
  history: texts.map((text) => ({ text, status: 'ok' as const })),
});

describe('typing and visibility', () => {
  it('a value change clears dismissed/manualOpen and resets navigation/history index', () => {
    const s = run(initialPromptState(), { kind: 'value/change', value: 'ver', caret: 3 }).state;
    expect(s.value).toBe('ver');
    expect(isPaletteOpen(s)).toBe(true);
    expect(s.navigated).toBe(false);
    expect(s.histIndex).toBe(-1);
    expect(s.activeId).toBe(paletteItems(s)[0].id); // activeId invariant
  });

  it('the palette is closed on an empty line but ⌃Space browses it open', () => {
    expect(isPaletteOpen(initialPromptState())).toBe(false);
    const s = run(initialPromptState(), { kind: 'key/ctrlSpace' }).state;
    expect(s.manualOpen).toBe(true);
    expect(isPaletteOpen(s)).toBe(true);
  });

  it('⌃Space then Escape closes the palette (manualOpen cleared, dismissed set)', () => {
    const s = run(initialPromptState(), { kind: 'key/ctrlSpace' }, { kind: 'key/escape' }).state;
    expect(s.manualOpen).toBe(false);
    expect(s.dismissed).toBe(true);
    expect(isPaletteOpen(s)).toBe(false);
  });

  it('caret/set updates the caret and reselects', () => {
    const s = run({ ...initialPromptState(), value: 'set radio', caret: 9 }, { kind: 'caret/set', caret: 3 }).state;
    expect(s.caret).toBe(3);
  });
});

describe('history recall', () => {
  it('↑↑ steps back twice — the first ↑ also sets dismissed so the second is history, not selection', () => {
    const base = { ...withHistory(['ver', 'board']), value: 'dr', caret: 2, dismissed: true };
    const one = run(base, { kind: 'key/arrowUp' }).state;
    expect(one.value).toBe('board'); // newest
    expect(one.draft).toBe('dr');
    expect(one.dismissed).toBe(true);
    const two = run(one, { kind: 'key/arrowUp' }).state;
    expect(two.value).toBe('ver'); // older
  });

  it('↓ past the newest restores the saved draft', () => {
    const base = { ...withHistory(['ver']), value: 'dr', caret: 2, dismissed: true };
    const up = run(base, { kind: 'key/arrowUp' }).state;
    const down = run(up, { kind: 'key/arrowDown' }).state;
    expect(down.value).toBe('dr');
    expect(down.histIndex).toBe(-1);
  });
});

describe('palette navigation follows display order', () => {
  it('↓/↑ step through the rendered (grouped) order, not the raw score rank', () => {
    // Expected order is derived INDEPENDENTLY of the reducer (from suggest +
    // orderedSuggestions), and we assert it genuinely differs from raw rank —
    // otherwise this test could pass even if the reducer navigated raw order.
    const { parse, items } = suggest('set', 3, { recent: [], nodeValues: {} });
    const raw = items.map((i) => i.id);
    const display = orderedSuggestions(parse, items).map((i) => i.id);
    expect(display.length).toBeGreaterThan(2);
    expect(raw).not.toEqual(display); // 'set' truly regroups (raw[1] ≠ display[1])

    const base = run(initialPromptState(), { kind: 'value/change', value: 'set', caret: 3 }).state;
    expect(base.activeId).toBe(display[0]); // default lands on the first visual row
    const d1 = run(base, { kind: 'key/arrowDown' }).state;
    expect(d1.activeId).toBe(display[1]);
    expect(d1.activeId).not.toBe(raw[1]); // fails if the reducer navigates raw rank
    const d2 = run(d1, { kind: 'key/arrowDown' }).state;
    expect(d2.activeId).toBe(display[2]);
    const u1 = run(d2, { kind: 'key/arrowUp' }).state;
    expect(u1.activeId).toBe(display[1]);
  });
});

describe('Tab and ghost', () => {
  it('Tab on a closed empty prompt opens the palette', () => {
    const s = run(initialPromptState(), { kind: 'key/tab' }).state;
    expect(isPaletteOpen(s)).toBe(true);
  });

  it('Tab completes to the common prefix', () => {
    const s = run({ ...initialPromptState(), value: 'set flood.m', caret: 11 }, { kind: 'key/tab' }).state;
    expect(s.value).toBe('set flood.max');
  });

  it('accepting the ghost appends only the suffix, preserving typed casing', () => {
    const s: CliPromptState = { ...initialPromptState(), value: 'SET r', caret: 5 };
    expect(ghostSuffix(s)).toBe('adio'); // top item 'set radio'
    const applied = run(s, { kind: 'key/acceptGhost' }).state;
    expect(applied.value).toBe('SET radio');
  });
});

describe('Enter', () => {
  it('applies the selection instead of running when the palette is open and navigated', () => {
    const open = { ...initialPromptState(), value: 've', caret: 2 };
    const nav = run(open, { kind: 'key/arrowDown' }).state; // navigated
    const { state, effect } = run(nav, { kind: 'key/enter' });
    expect(effect).toBeUndefined();
    expect(state.value.startsWith('v')).toBe(true);
  });

  it('Escape-then-Enter submits (navigated survives Escape, but open does not)', () => {
    const open = { ...initialPromptState(), value: 'ver', caret: 3 };
    const nav = run(open, { kind: 'key/arrowDown' }).state;
    const dismissed = run(nav, { kind: 'key/escape' }).state;
    expect(dismissed.navigated).toBe(true);
    const { effect } = run(dismissed, { kind: 'key/enter' });
    expect(effect).toEqual({ kind: 'submit', text: 'ver' });
  });

  it('a danger command routes to confirmPending instead of submitting', () => {
    const s = { ...initialPromptState(), value: 'poweroff', caret: 8, dismissed: true };
    const { state, effect } = run(s, { kind: 'key/enter' });
    expect(effect).toBeUndefined();
    expect(state.confirmPending?.cmd.name).toBe('poweroff');
    expect(run(state, { kind: 'confirm/cancel' }).state.confirmPending).toBeNull();
  });

  it('a plain command submits and clears the line', () => {
    const s = { ...initialPromptState(), value: 'ver', caret: 3, dismissed: true };
    const { state, effect } = run(s, { kind: 'key/enter' });
    expect(effect).toEqual({ kind: 'submit', text: 'ver' });
    expect(state.value).toBe('');
  });
});

describe('⌃L and non-key actions', () => {
  it('⌃L emits clearTranscript without touching state', () => {
    const { effect } = run(initialPromptState(), { kind: 'key/ctrlL' });
    expect(effect).toEqual({ kind: 'clearTranscript' });
  });

  it('line/set prefills without running (follow-up chip)', () => {
    const s = run(initialPromptState(), { kind: 'line/set', text: 'set radio 869.525,250,11,5' }).state;
    expect(s.value).toBe('set radio 869.525,250,11,5');
    expect(isPaletteOpen(s)).toBe(true);
  });

  it('item/apply applies a clicked row', () => {
    const s = { ...initialPromptState(), value: 'set ra', caret: 6 };
    const id = paletteItems(s).find((i) => i.label === 'set radio')?.id as string;
    const applied = run(s, { kind: 'item/apply', id }).state;
    expect(applied.value).toBe('set radio ');
  });

  it('item/activate moves the highlight/detail to the hovered row WITHOUT arming Enter', () => {
    const s = run(initialPromptState(), { kind: 'value/change', value: 'set', caret: 3 }).state;
    const target = paletteItems(s)[2]; // a row other than the default-selected first
    const out = run(s, { kind: 'item/activate', id: target.id }).state;
    expect(out.activeId).toBe(target.id); // highlight + detail pane follow the mouse
    expect(out.navigated).toBe(false); // but hover does not make it a selection
    // Enter still submits the TYPED line, not the hovered command.
    expect(run(out, { kind: 'key/enter' }).effect).toEqual({ kind: 'submit', text: 'set' });
  });

  it('hover is path-independent: default row vs away-and-back both leave Enter meaning "send typed"', () => {
    const s = run(initialPromptState(), { kind: 'value/change', value: 'set', caret: 3 }).state;
    const first = paletteItems(s)[0].id;
    const other = paletteItems(s)[2].id;
    expect(s.activeId).toBe(first);
    // hover the already-active default row → unchanged, not armed
    const a = run(s, { kind: 'item/activate', id: first }).state;
    expect(a.navigated).toBe(false);
    // hover another row then back to the default → still not armed
    const b = run(s, { kind: 'item/activate', id: other }, { kind: 'item/activate', id: first }).state;
    expect(b.activeId).toBe(first);
    expect(b.navigated).toBe(false);
    // both paths → Enter submits the typed line
    expect(run(a, { kind: 'key/enter' }).effect).toEqual({ kind: 'submit', text: 'set' });
    expect(run(b, { kind: 'key/enter' }).effect).toEqual({ kind: 'submit', text: 'set' });
  });

  it('item/activate is a no-op when the palette is closed or the id is stale', () => {
    const closed = run(initialPromptState(), { kind: 'item/activate', id: 'c:ver' }).state;
    expect(closed.activeId).toBe(''); // empty line → palette closed → ignored
    const open = run(initialPromptState(), { kind: 'value/change', value: 'set', caret: 3 }).state;
    const stale = run(open, { kind: 'item/activate', id: 'c:nope-not-a-real-id' }).state;
    expect(stale.navigated).toBe(false);
    expect(stale.activeId).toBe(open.activeId);
  });

  it('history/push then history/patchStatus record and amend the newest line', () => {
    const pushed = run(initialPromptState(), { kind: 'history/push', entry: { text: 'ver', status: 'sent' } }).state;
    expect(pushed.history.at(-1)).toEqual({ text: 'ver', status: 'sent' });
    const patched = run(pushed, { kind: 'history/patchStatus', status: 'ok' }).state;
    expect(patched.history.at(-1)).toEqual({ text: 'ver', status: 'ok' });
  });

  it('ctx/setNodeValue and ctx/setRecent update the suggestion context', () => {
    const withNode = run(initialPromptState(), { kind: 'ctx/setNodeValue', key: 'radio', value: '869.525,250,11,5' }).state;
    expect(withNode.ctx.nodeValues.radio).toBe('869.525,250,11,5');
    const withRecent = run(withNode, { kind: 'ctx/setRecent', recent: ['ver'] }).state;
    expect(withRecent.ctx.recent).toEqual(['ver']);
  });

  it('history/loaded replaces history and resets the recall index', () => {
    const loaded = run(
      { ...initialPromptState(), histIndex: 2 },
      {
        kind: 'history/loaded',
        history: [
          { text: 'ver', status: 'ok' },
          { text: 'board', status: 'ok' },
        ],
      },
    ).state;
    expect(loaded.history.map((h) => h.text)).toEqual(['ver', 'board']);
    expect(loaded.histIndex).toBe(-1);
  });
});

describe('reverse-i-search', () => {
  it('⌃R enters search saving the line; typing filters; Enter accepts and runs', () => {
    const base = { ...withHistory(['get radio', 'set tx 22', 'ver']), value: 'draft', caret: 5 };
    const entered = run(base, { kind: 'key/ctrlR' }).state;
    expect(entered.rsearch?.restore).toBe('draft');
    const typed = run(entered, { kind: 'rsearch/setQuery', query: 'tx' }).state;
    expect(rsearchView(typed).text).toBe('set tx 22');
    const { state, effect } = run(typed, { kind: 'key/enter' });
    expect(effect).toEqual({ kind: 'submit', text: 'set tx 22' });
    expect(state.rsearch).toBeNull();
  });

  it('⌃R clamps at the oldest match', () => {
    const base = withHistory(['radio a', 'radio b']); // both match 'radio'
    const s = run(
      base,
      { kind: 'key/ctrlR' },
      { kind: 'rsearch/setQuery', query: 'radio' },
      { kind: 'key/ctrlR' },
      { kind: 'key/ctrlR' },
      { kind: 'key/ctrlR' },
    ).state;
    // newest-first: index 0 = 'radio b', index 1 = 'radio a' (oldest), clamped there.
    expect(rsearchView(s).index).toBe(1);
    expect(rsearchView(s).text).toBe('radio a');
  });

  it('Escape aborts and restores the saved line', () => {
    const base = { ...withHistory(['ver']), value: 'draft', caret: 5 };
    const s = run(base, { kind: 'key/ctrlR' }, { kind: 'key/escape' }).state;
    expect(s.rsearch).toBeNull();
    expect(s.value).toBe('draft');
  });

  it('key/ctrlG aborts reverse-search and restores the saved line', () => {
    const base = { ...withHistory(['ver']), value: 'draft', caret: 5 };
    const s = run(base, { kind: 'key/ctrlR' }, { kind: 'key/ctrlG' }).state;
    expect(s.rsearch).toBeNull();
    expect(s.value).toBe('draft');
  });
});
