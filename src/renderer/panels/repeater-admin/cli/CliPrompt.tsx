import { Radio } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { RadioSettings } from '../../../../shared/types';
import { CliConfirmBar } from './CliConfirmBar';
import { CLI_PALETTE_LISTBOX_ID, CliPalette } from './CliPalette';
import { CliReverseSearch } from './CliReverseSearch';
import { cliRoundTrip } from './lib/airtime';
import { resolveCommand } from './lib/parse';
import type { CliHistoryEntry } from './lib/persistence';
import { type CliPromptState, cliPromptReducer, ghostSuffix, isPaletteOpen, rsearchMatches } from './lib/promptReducer';
import { type CliSuggestCtx, suggest } from './lib/suggest';

export type CliGuest = 'checking' | 'guest' | 'admin';

export interface CliPromptProps {
  history: CliHistoryEntry[];
  ctx: CliSuggestCtx;
  radioSettings: RadioSettings | null;
  hops: number;
  guest: CliGuest;
  queuedCount: number;
  onSubmit: (text: string) => void;
  onClearTranscript: () => void;
  onLoginAsAdmin: () => void;
  lineToSet?: { text: string; nonce: number } | null;
}

function initialState(history: CliHistoryEntry[], ctx: CliSuggestCtx): CliPromptState {
  return {
    value: '',
    caret: 0,
    history,
    histIndex: -1,
    draft: '',
    manualOpen: false,
    dismissed: false,
    navigated: false,
    activeId: '',
    rsearch: null,
    confirmPending: null,
    ctx,
  };
}

export function CliPrompt({
  history,
  ctx,
  radioSettings,
  hops,
  guest,
  queuedCount,
  onSubmit,
  onClearTranscript,
  onLoginAsAdmin,
  lineToSet,
}: CliPromptProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<CliPromptState>(() => initialState(history, ctx));
  const stateRef = useRef(state);
  stateRef.current = state;

  // Effects the reducer emits act on the queue/transcript, which it does not own.
  const applyEffect = useCallback(
    (effect?: { kind: 'submit'; text: string } | { kind: 'clearTranscript' }) => {
      if (!effect) return;
      if (effect.kind === 'submit') {
        if (guest === 'checking' || guest === 'guest') return; // §8: submit is a no-op without admin
        onSubmit(effect.text);
      } else if (effect.kind === 'clearTranscript') {
        onClearTranscript();
      }
    },
    [guest, onSubmit, onClearTranscript],
  );

  const dispatch = useCallback(
    (action: Parameters<typeof cliPromptReducer>[1]) => {
      const { state: next, effect } = cliPromptReducer(stateRef.current, action);
      stateRef.current = next;
      setState(next);
      applyEffect(effect);
    },
    [applyEffect],
  );

  // Re-sync reducer-held history/ctx when the parent's persisted stores change.
  useEffect(() => dispatch({ kind: 'history/loaded', history }), [history, dispatch]);
  useEffect(() => dispatch({ kind: 'ctx/setRecent', recent: ctx.recent }), [ctx.recent, dispatch]);
  useEffect(() => {
    for (const [key, value] of Object.entries(ctx.nodeValues)) dispatch({ kind: 'ctx/setNodeValue', key, value });
  }, [ctx.nodeValues, dispatch]);

  // Follow-up chip prefill (§5.5): line/set, not a send.
  useEffect(() => {
    if (lineToSet) dispatch({ kind: 'line/set', text: lineToSet.text });
  }, [lineToSet, dispatch]);

  // Apply the caret imperatively after each commit — the value is controlled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: state.value is not read in the body, but it must stay a dependency — writing a controlled input's value resets the native caret to end-of-string, so a value-only commit (e.g. re-typing an arg of the same length, landing the reducer's caret at the same index as before) needs this effect to re-run and correct it even though state.caret alone didn't change.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && el.selectionStart !== state.caret) el.setSelectionRange(state.caret, state.caret);
  }, [state.caret, state.value]);

  const { parse, items } = useMemo(
    () => suggest(state.value, state.caret, state.ctx),
    [state.value, state.caret, state.ctx],
  );
  const open = isPaletteOpen(state);

  // Ghost: only at end-of-line, when the top item's label prefix-matches the
  // token case-insensitively; the suffix preserves the user's typed casing.
  const ghost = ghostSuffix(state);

  const cmd = parse.mode === 'arg' ? parse.cmd : resolveCommand(state.value);
  const airtime =
    state.value.trim() === ''
      ? ''
      : radioSettings
        ? cliRoundTrip(state.value.trim(), radioSettings, hops, !!cmd?.noReply).label
        : '—';

  const canSubmit = guest === 'admin' && state.value.trim() !== '';

  // The reducer's own filtered, newest-first match list — reused so the index
  // rsearch.index points into stays in the same space the reducer navigates.
  const rmatches = state.rsearch ? rsearchMatches(state.history, state.rsearch.query) : [];

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Map each key to a granular reducer action (§3.1). Reverse-search typing
    // routes to rsearch/setQuery; →/End accepts either the active rsearch match
    // or an end-of-line ghost via the reducer's shared key/acceptGhost (§3.2).
    // `a` is only non-null when there's something for the reducer to do with
    // this key, so every branch that returns an action also preventDefaults —
    // when there's nothing to accept, `a` is null and native cursor movement
    // (e.g. plain ArrowRight/End) still happens.
    const a = (() => {
      if (state.rsearch) {
        if (e.key === 'Backspace') return { kind: 'rsearch/setQuery', query: state.rsearch.query.slice(0, -1) } as const;
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey)
          return { kind: 'rsearch/setQuery', query: state.rsearch.query + e.key } as const;
      }
      // Ctrl-only, on every platform: these are readline/terminal chords (⌃R
      // reverse-search, ⌃L clear, ⌃Space palette, ⌃G abort), and the shortcuts
      // registry defines them ctrl-only. Treating ⌘ as Ctrl would fire them on
      // macOS ⌘R/⌘L and collide with app-level shortcuts.
      if (e.ctrlKey && e.key === ' ') return { kind: 'key/ctrlSpace' } as const;
      if (e.ctrlKey && e.key === 'r') return { kind: 'key/ctrlR' } as const;
      if (e.ctrlKey && e.key === 'l') return { kind: 'key/ctrlL' } as const;
      if (e.ctrlKey && e.key === 'g') return { kind: 'key/ctrlG' } as const;
      switch (e.key) {
        case 'Tab':
          return { kind: 'key/tab' } as const;
        case 'ArrowUp':
          return { kind: 'key/arrowUp' } as const;
        case 'ArrowDown':
          return { kind: 'key/arrowDown' } as const;
        case 'Enter':
          return { kind: 'key/enter' } as const;
        case 'Escape':
          return { kind: 'key/escape' } as const;
        case 'ArrowRight':
        case 'End':
          if (state.rsearch) return { kind: 'key/acceptGhost' } as const;
          return state.caret === state.value.length && ghost ? ({ kind: 'key/acceptGhost' } as const) : null;
      }
      return null;
    })();
    if (a) {
      e.preventDefault();
      dispatch(a);
    }
  };

  const banner =
    guest === 'guest' ? (
      <div className="flex flex-wrap items-center gap-2 border-b border-cs-border bg-cs-warn/10 px-4 py-1.5 text-[11px] text-cs-text-muted">
        <span>This repeater only answers CLI from an admin session</span>
        <button
          type="button"
          onClick={onLoginAsAdmin}
          className="font-medium text-cs-accent underline-offset-2 hover:underline"
        >
          Log in as admin →
        </button>
      </div>
    ) : null;

  return (
    <div className="shrink-0 border-t border-cs-border bg-cs-bg-2">
      {banner}
      {state.confirmPending ? (
        <CliConfirmBar
          text={state.confirmPending.text}
          cmd={state.confirmPending.cmd}
          onConfirm={() => {
            const text = state.confirmPending?.text;
            dispatch({ kind: 'confirm/cancel' });
            if (text && guest === 'admin') onSubmit(text);
          }}
          onCancel={() => dispatch({ kind: 'confirm/cancel' })}
        />
      ) : null}
      {state.rsearch ? (
        <CliReverseSearch
          query={state.rsearch.query}
          match={rmatches[state.rsearch.index] ?? null}
          index={state.rsearch.index}
          total={rmatches.length}
        />
      ) : null}

      <div className="relative flex items-center gap-2 px-3 py-2">
        <span className="shrink-0 font-mono text-[13px] text-cs-text-muted">$</span>
        <div className="relative min-w-0 flex-1">
          <CliPalette
            open={open}
            parse={parse}
            items={items}
            activeId={state.activeId}
            nodeValues={state.ctx.nodeValues}
            radioSettings={radioSettings}
            hops={hops}
            onApply={(item) => dispatch({ kind: 'item/apply', id: item.id })}
          />
          <div
            aria-hidden="true"
            data-testid="cli-ghost"
            className="pointer-events-none absolute inset-0 flex items-center whitespace-pre font-mono text-[13px]"
          >
            <span className="invisible">{state.value}</span>
            <span className="text-cs-text-dim">{ghost}</span>
          </div>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={CLI_PALETTE_LISTBOX_ID}
            aria-activedescendant={open ? state.activeId || undefined : undefined}
            aria-label="Repeater CLI command"
            value={state.value}
            spellCheck={false}
            autoComplete="off"
            maxLength={132}
            placeholder="repeater command"
            onChange={(e) =>
              dispatch({
                kind: 'value/change',
                value: e.target.value,
                caret: e.target.selectionStart ?? e.target.value.length,
              })
            }
            onKeyUp={(e) => dispatch({ kind: 'caret/set', caret: e.currentTarget.selectionStart ?? 0 })}
            onClick={(e) => dispatch({ kind: 'caret/set', caret: e.currentTarget.selectionStart ?? 0 })}
            onKeyDown={onKeyDown}
            className="relative w-full bg-transparent font-mono text-[13px] text-cs-text caret-cs-accent outline-none placeholder:text-cs-text-dim"
          />
        </div>
        {airtime ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-cs-text-dim">
            <Radio size={10} aria-hidden="true" />
            {airtime}
          </span>
        ) : null}
        {queuedCount > 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-cs-text-dim">{queuedCount} queued</span>
        ) : null}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => dispatch({ kind: 'key/enter' })}
          className={cn(
            'shrink-0 rounded border border-cs-border px-3 py-1 text-[12px]',
            canSubmit ? 'bg-cs-accent-soft/30 text-cs-text hover:bg-cs-accent-soft/50' : 'text-cs-text-dim opacity-50',
          )}
        >
          Run
        </button>
      </div>
    </div>
  );
}
