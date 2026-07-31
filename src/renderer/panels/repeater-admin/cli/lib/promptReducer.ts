// The pure reducer over everything the keyboard touches. Making the keyboard a
// pure function is what makes it exhaustively testable without a DOM — the
// tricky interactions (navigated changes what Enter does, dismissed is a latch
// not a mirror of visibility, the history index shadows a saved draft, and
// reverse-search is modal) all live here. The reducer returns an OPTIONAL
// effect for the two things it does not own (the queue and the transcript);
// CliTab applies it. It calls suggest() itself, so callers keep no derived list
// in sync.
import type { CliCommand } from '../../../../../shared/repeater-cli/catalog';
import { commonPrefix } from './match';
import { parseCliLine, resolveCommand } from './parse';
import { type CliHistoryEntry, patchLastStatus, pushHistory } from './persistence';
import { applySuggestion, type CliSuggestCtx, type CliSuggestion, suggest } from './suggest';

export interface CliPromptState {
  value: string;
  caret: number;
  history: CliHistoryEntry[];
  histIndex: number; // -1 = not recalling
  draft: string; // saved on the first ArrowUp
  manualOpen: boolean;
  dismissed: boolean;
  navigated: boolean;
  activeId: string;
  rsearch: { query: string; index: number; restore: string } | null;
  confirmPending: { text: string; cmd: CliCommand } | null;
  ctx: CliSuggestCtx;
}

export type CliEffect = { kind: 'submit'; text: string } | { kind: 'clearTranscript' };

export type CliPromptAction =
  | { kind: 'value/change'; value: string; caret: number }
  | { kind: 'caret/set'; caret: number }
  | { kind: 'key/ctrlSpace' }
  | { kind: 'key/arrowUp' }
  | { kind: 'key/arrowDown' }
  | { kind: 'key/tab' }
  | { kind: 'key/acceptGhost' } // → / End
  | { kind: 'key/enter' }
  | { kind: 'key/escape' }
  | { kind: 'key/ctrlR' }
  | { kind: 'key/ctrlG' }
  | { kind: 'key/ctrlL' }
  | { kind: 'item/apply'; id: string }
  | { kind: 'line/set'; text: string }
  | { kind: 'history/loaded'; history: CliHistoryEntry[] }
  | { kind: 'history/push'; entry: CliHistoryEntry }
  | { kind: 'history/patchStatus'; status: CliHistoryEntry['status'] }
  | { kind: 'ctx/setNodeValue'; key: string; value: string }
  | { kind: 'ctx/setRecent'; recent: string[] }
  | { kind: 'rsearch/setQuery'; query: string }
  | { kind: 'confirm/cancel' };

export function initialPromptState(ctx?: Partial<CliSuggestCtx>): CliPromptState {
  return {
    value: '',
    caret: 0,
    history: [],
    histIndex: -1,
    draft: '',
    manualOpen: false,
    dismissed: false,
    navigated: false,
    activeId: '',
    rsearch: null,
    confirmPending: null,
    ctx: { recent: ctx?.recent ?? [], nodeValues: ctx?.nodeValues ?? {} },
  };
}

export function paletteItems(s: CliPromptState): CliSuggestion[] {
  return suggest(s.value, s.caret, s.ctx).items;
}

/** Derived, never stored. No `items.length > 0` term — a zero-item palette must
 *  still render §4.1's "press ↵ to send it raw" hint. */
export function isPaletteOpen(s: CliPromptState): boolean {
  return (s.manualOpen || (s.value.trim() !== '' && !s.dismissed)) && !s.rsearch && !s.confirmPending;
}

/** activeId invariant: whenever the item list changes and navigated is false,
 *  activeId is items[0].id. Nothing else initialises it. */
function reselect(s: CliPromptState): CliPromptState {
  if (s.navigated) return s;
  return { ...s, activeId: paletteItems(s)[0]?.id ?? '' };
}

/** The ghost suffix: rendered only when the caret is at end and the top item's
 *  label prefix-matches the current token case-insensitively. Accepting appends
 *  only the suffix, preserving typed casing. */
export function ghostSuffix(s: CliPromptState): string {
  if (!isPaletteOpen(s) || s.caret !== s.value.length) return '';
  const top = paletteItems(s)[0];
  if (!top) return '';
  const token = parseCliLine(s.value, s.caret).token;
  if (top.label.length > token.length && top.label.toLowerCase().startsWith(token.toLowerCase())) {
    return top.label.slice(token.length);
  }
  return '';
}

export function rsearchMatches(history: CliHistoryEntry[], query: string): CliHistoryEntry[] {
  const q = query.toLowerCase();
  const out: CliHistoryEntry[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (!q || history[i].text.toLowerCase().includes(q)) out.push(history[i]);
  }
  return out;
}

export function rsearchView(s: CliPromptState): { text: string | null; index: number; total: number } {
  if (!s.rsearch) return { text: null, index: 0, total: 0 };
  const matches = rsearchMatches(s.history, s.rsearch.query);
  return { text: matches[s.rsearch.index]?.text ?? null, index: s.rsearch.index, total: matches.length };
}

function applyItem(s: CliPromptState, item: CliSuggestion): CliPromptState {
  const { value, caret } = applySuggestion(s.value, s.caret, item);
  const hasArgs = !!(item.cmd && (item.cmd.args || item.cmd.spec));
  // No-args → close; with-args → leave open so arg suggestions appear.
  return reselect({ ...s, value, caret, navigated: false, manualOpen: false, dismissed: !hasArgs, histIndex: -1 });
}

function clearLine(s: CliPromptState): CliPromptState {
  return {
    ...s,
    value: '',
    caret: 0,
    histIndex: -1,
    draft: '',
    navigated: false,
    manualOpen: false,
    dismissed: false,
    activeId: '',
  };
}

export function cliPromptReducer(s: CliPromptState, a: CliPromptAction): { state: CliPromptState; effect?: CliEffect } {
  switch (a.kind) {
    case 'value/change':
      return {
        state: reselect({
          ...s,
          value: a.value,
          caret: a.caret,
          dismissed: false,
          manualOpen: false,
          histIndex: -1,
          navigated: false,
        }),
      };

    case 'caret/set':
      return { state: reselect({ ...s, caret: a.caret }) };

    case 'key/ctrlSpace':
      return { state: reselect({ ...s, manualOpen: !s.manualOpen, dismissed: false, navigated: false }) };

    case 'key/arrowUp': {
      if (s.rsearch) return { state: s }; // modal — swallowed
      if (isPaletteOpen(s)) {
        const items = paletteItems(s);
        if (!items.length) return { state: s };
        const cur = items.findIndex((i) => i.id === s.activeId);
        return { state: { ...s, activeId: items[Math.max(0, cur - 1)].id, navigated: true } };
      }
      if (s.history.length === 0) return { state: s };
      const first = s.histIndex === -1;
      const index = Math.min(first ? 0 : s.histIndex + 1, s.history.length - 1);
      const entry = s.history[s.history.length - 1 - index];
      return {
        state: reselect({
          ...s,
          value: entry.text,
          caret: entry.text.length,
          draft: first ? s.value : s.draft,
          histIndex: index,
          dismissed: true,
          navigated: false,
        }),
      };
    }

    case 'key/arrowDown': {
      if (s.rsearch) return { state: s };
      if (isPaletteOpen(s)) {
        const items = paletteItems(s);
        if (!items.length) return { state: s };
        const cur = items.findIndex((i) => i.id === s.activeId);
        return { state: { ...s, activeId: items[Math.min(items.length - 1, cur + 1)].id, navigated: true } };
      }
      if (s.histIndex === -1) return { state: s };
      if (s.histIndex === 0) {
        return { state: reselect({ ...s, value: s.draft, caret: s.draft.length, histIndex: -1, navigated: false }) };
      }
      const index = s.histIndex - 1;
      const entry = s.history[s.history.length - 1 - index];
      return { state: reselect({ ...s, value: entry.text, caret: entry.text.length, histIndex: index, navigated: false }) };
    }

    case 'key/tab': {
      if (s.rsearch) {
        const { text } = rsearchView(s);
        if (text === null) return { state: { ...s, rsearch: null } };
        return {
          state: reselect({ ...s, value: text, caret: text.length, rsearch: null, navigated: false, dismissed: false }),
        };
      }
      if (!isPaletteOpen(s)) return { state: reselect({ ...s, manualOpen: true, dismissed: false, navigated: false }) };
      const items = paletteItems(s);
      if (items.length === 0) return { state: s };
      if (items.length === 1) return { state: applyItem(s, items[0]) };
      if (s.navigated) return { state: applyItem(s, items.find((i) => i.id === s.activeId) ?? items[0]) };
      const prefix = commonPrefix(items);
      const parse = parseCliLine(s.value, s.caret);
      if (prefix && prefix.length > parse.token.length) {
        const value = s.value.slice(0, parse.start) + prefix + s.value.slice(s.caret);
        return { state: reselect({ ...s, value, caret: parse.start + prefix.length, navigated: false }) };
      }
      return { state: { ...s, navigated: true } };
    }

    case 'key/acceptGhost': {
      if (s.rsearch) {
        const { text } = rsearchView(s);
        if (text === null) return { state: s };
        return {
          state: reselect({ ...s, value: text, caret: text.length, rsearch: null, navigated: false, dismissed: false }),
        };
      }
      const suffix = ghostSuffix(s);
      if (!suffix) return { state: s }; // caller falls through to native cursor move
      const value = s.value + suffix;
      return { state: reselect({ ...s, value, caret: value.length, navigated: false }) };
    }

    case 'key/enter': {
      if (s.rsearch) {
        const { text } = rsearchView(s);
        if (text === null) return { state: s };
        return { state: clearLine({ ...s, rsearch: null }), effect: { kind: 'submit', text } };
      }
      if (isPaletteOpen(s) && s.navigated) {
        const sel = paletteItems(s).find((i) => i.id === s.activeId);
        return { state: sel ? applyItem(s, sel) : s };
      }
      const text = s.value.trim();
      if (text === '') return { state: s };
      const cmd = resolveCommand(text);
      if (cmd?.danger) return { state: { ...s, confirmPending: { text, cmd } } };
      return { state: clearLine(s), effect: { kind: 'submit', text } };
    }

    case 'key/escape': {
      if (s.confirmPending) return { state: { ...s, confirmPending: null } };
      if (s.rsearch)
        return { state: reselect({ ...s, value: s.rsearch.restore, caret: s.rsearch.restore.length, rsearch: null }) };
      if (isPaletteOpen(s)) return { state: { ...s, manualOpen: false, dismissed: true } };
      return { state: { ...s, value: '', caret: 0, histIndex: -1, navigated: false } };
    }

    case 'key/ctrlR': {
      if (s.rsearch) {
        const total = rsearchMatches(s.history, s.rsearch.query).length;
        if (total === 0) return { state: s };
        return { state: { ...s, rsearch: { ...s.rsearch, index: Math.min(s.rsearch.index + 1, total - 1) } } };
      }
      return { state: { ...s, rsearch: { query: '', index: 0, restore: s.value } } };
    }

    case 'key/ctrlG':
      if (!s.rsearch) return { state: s };
      return { state: reselect({ ...s, value: s.rsearch.restore, caret: s.rsearch.restore.length, rsearch: null }) };

    case 'key/ctrlL':
      return { state: s, effect: { kind: 'clearTranscript' } };

    case 'item/apply': {
      const item = paletteItems(s).find((i) => i.id === a.id);
      return { state: item ? applyItem(s, item) : s };
    }

    case 'line/set':
      return {
        state: reselect({
          ...s,
          value: a.text,
          caret: a.text.length,
          histIndex: -1,
          navigated: false,
          dismissed: false,
          manualOpen: false,
        }),
      };

    case 'history/loaded':
      return { state: { ...s, history: a.history, histIndex: -1 } };

    case 'history/push':
      return { state: { ...s, history: pushHistory(s.history, a.entry), histIndex: -1 } };

    case 'history/patchStatus':
      return { state: { ...s, history: patchLastStatus(s.history, a.status) } };

    case 'ctx/setNodeValue':
      return { state: reselect({ ...s, ctx: { ...s.ctx, nodeValues: { ...s.ctx.nodeValues, [a.key]: a.value } } }) };

    case 'ctx/setRecent':
      return { state: reselect({ ...s, ctx: { ...s.ctx, recent: a.recent } }) };

    case 'rsearch/setQuery':
      if (!s.rsearch) return { state: s };
      return { state: { ...s, rsearch: { ...s.rsearch, query: a.query, index: 0 } } };

    case 'confirm/cancel':
      return { state: { ...s, confirmPending: null } };
  }
}
