import { type CSSProperties, type RefObject, useMemo, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { MacroVariable } from '../../../../shared/macros/types';
import { detectOpenVarTag } from '../lib/autocomplete';
import { MACRO_CATALOG } from '../lib/catalog';
import { TOKEN_COLORS } from '../lib/tokenColors';
import { keyedRuns, tokenize } from '../lib/tokenize';
import type { PreviewMode } from './useStudio';

// Shared metrics so the painted <pre> and the real <textarea> register glyph
// for glyph — the textarea is transparent and layered exactly over the colours.
const EDITOR_STYLE: CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 14,
  lineHeight: 1.7,
  padding: '14px 16px',
  letterSpacing: 0,
  tabSize: 2,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0,
  border: 0,
};

interface AcState {
  partial: string;
  start: number;
  end: number;
  items: MacroVariable[];
  sel: number;
}

interface MacroEditorProps {
  value: string;
  onChange: (v: string) => void;
  taRef: RefObject<HTMLTextAreaElement | null>;
  mode: PreviewMode;
  variables: MacroVariable[];
  placeholder?: string;
  minHeight?: number;
}

export function MacroEditor({ value, onChange, taRef, mode, variables, placeholder, minHeight = 120 }: MacroEditorProps) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [ac, setAc] = useState<AcState | null>(null);

  const runs = useMemo(() => keyedRuns(tokenize(value, mode, MACRO_CATALOG).runs), [value, mode]);

  const refreshAutocomplete = (text: string, caret: number) => {
    const open = detectOpenVarTag(text.slice(0, caret));
    if (!open) {
      setAc(null);
      return;
    }
    const partial = open.partial.toLowerCase();
    const items = variables.filter((v) => v.name.toLowerCase().includes(partial)).slice(0, 8);
    if (!items.length) {
      setAc(null);
      return;
    }
    setAc((prev) => {
      // Preserve the keyboard selection when the menu is unchanged. ArrowUp/Down
      // are handled in onKeyDown, but their onKeyUp re-runs this with the same
      // caret — without this guard it would snap the highlight back to the top,
      // making every item below the first unreachable by keyboard.
      const sameMenu =
        prev !== null &&
        prev.start === open.start &&
        prev.items.length === items.length &&
        prev.items.every((it, i) => it.name === items[i].name);
      const sel = sameMenu ? Math.min(prev.sel, items.length - 1) : 0;
      return { partial: open.partial, start: open.start, end: caret, items, sel };
    });
  };

  const complete = (variable: MacroVariable) => {
    if (!ac) return;
    const next = `${value.slice(0, ac.start)}{{ ${variable.name} }}${value.slice(ac.end)}`;
    onChange(next);
    setAc(null);
    const caret = ac.start + `{{ ${variable.name} }}`.length;
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  return (
    <Popover
      open={ac !== null}
      onOpenChange={(o) => {
        if (!o) setAc(null);
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative overflow-hidden rounded-[10px] border border-cs-border bg-cs-bg-2" style={{ minHeight }}>
          <pre
            ref={preRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-auto text-cs-text"
            style={EDITOR_STYLE}
          >
            {runs.map((run) => (
              <span
                key={run.key}
                style={{
                  color: TOKEN_COLORS[run.type],
                  fontWeight: run.type === 'variable' || run.type === 'filter' || run.type === 'custom' ? 500 : 400,
                  ...(run.type === 'error'
                    ? { textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationColor: TOKEN_COLORS.error }
                    : run.type === 'unavail'
                      ? {
                          textDecoration: 'underline',
                          textDecorationStyle: 'wavy',
                          textDecorationColor: TOKEN_COLORS.unavail,
                        }
                      : {}),
                }}
              >
                {run.text}
              </span>
            ))}
            {value.endsWith('\n') ? '​' : null}
          </pre>

          {value === '' && placeholder ? (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 text-cs-text-dim" style={EDITOR_STYLE}>
              {placeholder}
            </div>
          ) : null}

          <textarea
            data-testid="macro-editor"
            ref={taRef}
            value={value}
            spellCheck={false}
            aria-label="Macro template"
            onChange={(e) => {
              onChange(e.target.value);
              refreshAutocomplete(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onScroll={(e) => {
              if (preRef.current) preRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyUp={(e) => refreshAutocomplete(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onClick={(e) => refreshAutocomplete(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onBlur={() => setAc(null)}
            onKeyDown={(e) => {
              if (!ac) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAc({ ...ac, sel: (ac.sel + 1) % ac.items.length });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setAc({ ...ac, sel: (ac.sel - 1 + ac.items.length) % ac.items.length });
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                complete(ac.items[ac.sel]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setAc(null);
              }
            }}
            className="relative h-full w-full resize-none bg-transparent text-transparent caret-cs-accent outline-none"
            style={{ ...EDITOR_STYLE, minHeight }}
          />
        </div>
      </PopoverAnchor>
      {ac ? (
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          // Keep focus in the textarea so the user can keep typing to filter.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // Typing / clicking in the editor must not dismiss the menu.
          onInteractOutside={(e) => {
            const target = e.target as Node | null;
            if (target && taRef.current?.contains(target)) e.preventDefault();
          }}
          className="w-72 p-1"
        >
          {ac.items.map((v, i) => (
            <button
              key={v.name}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                complete(v);
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left font-mono text-[12px]',
                i === ac.sel ? 'bg-cs-bg-3' : 'hover:bg-cs-bg-3',
              )}
            >
              <span className={v.available === 'reply' ? 'text-cs-text' : 'text-cs-accent'}>{v.name}</span>
              <span className="text-[10px] text-cs-text-dim">{v.available}</span>
            </button>
          ))}
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
