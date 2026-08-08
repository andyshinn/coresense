import { useLayoutEffect, useRef, useState } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { CliCommand } from '../../../../shared/repeater-cli/catalog';
import type { RadioSettings } from '../../../../shared/types';
import { CliDetail } from './CliDetail';
import { cliRoundTrip } from './lib/airtime';
import type { CliParse } from './lib/parse';
import { type CliSuggestion, groupSuggestions } from './lib/suggest';

const DETAIL_W = 250;
const DETAIL_MIN = 560; // below this the two-pane detail folds to inline
const LIST_MAX_H = 302;

// Stable id for the listbox so Task 4's prompt input can own the authoritative
// aria-activedescendant/aria-controls pair (the FOCUSED element must own it).
export const CLI_PALETTE_LISTBOX_ID = 'cli-palette-listbox';

export interface CliPaletteProps {
  open: boolean;
  parse: CliParse;
  items: CliSuggestion[];
  activeId: string;
  nodeValues: Record<string, string>;
  radioSettings: RadioSettings | null;
  hops: number;
  onApply: (item: CliSuggestion) => void;
  onActivate?: (item: CliSuggestion) => void;
}

interface Chip {
  key: string;
  label: string;
  title: string;
  className: string;
}

// The over-the-air facts, as chips. Order matters: blockers first. Tokens are
// the concrete §4.5 tints; contrast is measured against each chip's own fill.
function cmdChips(cmd: CliCommand | undefined): Chip[] {
  if (!cmd) return [];
  const out: Chip[] = [];
  if (cmd.serialOnly)
    out.push({
      key: 'serial',
      label: 'serial only',
      title: 'Never answered over the air — wired console only',
      className: 'bg-cs-bg-3 text-cs-text-dim',
    });
  if (cmd.danger)
    out.push({
      key: 'danger',
      label: 'destructive',
      title: 'Asks for confirmation before sending',
      className: 'bg-cs-danger/15 text-cs-danger',
    });
  if (cmd.noReply)
    out.push({
      key: 'noreply',
      label: 'no reply',
      title: 'The node never answers this',
      className: 'bg-cs-bg-3 text-cs-text-muted',
    });
  if (cmd.reboot)
    out.push({
      key: 'reboot',
      label: 'reboot',
      title: 'Takes effect only after a reboot',
      className: 'border border-cs-accent/30 bg-cs-accent-soft text-cs-accent',
    });
  if (cmd.fw)
    out.push({
      key: 'fw',
      label: `v${cmd.fw}+`,
      title: `Needs firmware ${cmd.fw} or newer`,
      className: 'bg-cs-bg-3 italic text-cs-text-muted',
    });
  if (cmd.deprecated)
    out.push({
      key: 'dep',
      label: 'deprecated',
      title: `Deprecated as of firmware ${cmd.deprecated}`,
      className: 'bg-cs-bg-3 text-cs-text-dim',
    });
  if (cmd.experimental)
    out.push({ key: 'exp', label: 'exp', title: 'Experimental', className: 'bg-cs-bg-3 text-cs-text-dim' });
  return out;
}

function Highlight({ text, ranges }: { text: string; ranges?: [number, number][] }) {
  if (!ranges || ranges.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let i = 0;
  ranges.forEach(([a, b]) => {
    if (a > i) out.push(<span key={`p${a}`}>{text.slice(i, a)}</span>);
    out.push(
      <span key={`m${a}`} className="text-cs-accent">
        {text.slice(a, b)}
      </span>,
    );
    i = b;
  });
  if (i < text.length) out.push(<span key="t">{text.slice(i)}</span>);
  return <>{out}</>;
}

function useWidth(anchor: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(420);
  useLayoutEffect(() => {
    const measure = () => {
      const el = anchor.current;
      if (!el) return;
      const available = window.innerWidth - el.getBoundingClientRect().left;
      setWidth(Math.max(380, Math.min(660, available - 20)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);
  return width;
}

function Row({
  item,
  selected,
  onApply,
  onActivate,
}: {
  item: CliSuggestion;
  selected: boolean;
  onApply: (i: CliSuggestion) => void;
  onActivate?: (i: CliSuggestion) => void;
}) {
  const chips = cmdChips(item.cmd);
  return (
    <button
      type="button"
      role="option"
      id={item.id}
      aria-selected={selected}
      // Hover activates the row like ↑/↓ do, so the detail pane shows its docs
      // before any click. onMouseEnter (not onMouseMove) keeps it to one event
      // per row entry; keyboard nav over a stationary mouse never re-fires it.
      onMouseEnter={() => onActivate?.(item)}
      // onMouseDown + preventDefault: onClick would blur the prompt first.
      onMouseDown={(e) => {
        e.preventDefault();
        onApply(item);
      }}
      className={cn(
        'flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left',
        item.serialOnly && 'opacity-50',
        selected ? 'bg-cs-bg-3' : 'hover:bg-cs-bg-3',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="shrink-0 whitespace-nowrap font-mono text-[12.5px] text-cs-text">
            <Highlight text={item.label} ranges={item.ranges} />
          </span>
          {item.cmd?.spec ? <span className="truncate font-mono text-[11px] text-cs-text-dim">{item.cmd.spec}</span> : null}
        </span>
        {item.kind !== 'command' ? (
          <span className="mt-0.5 block truncate text-[11px] leading-snug text-cs-text-dim">{item.desc}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {item.meta && item.kind !== 'command' ? (
          <span
            className="rounded-sm bg-cs-bg-3 px-1 font-mono uppercase tracking-wider text-cs-text-muted"
            style={{ fontSize: 9, lineHeight: '15px' }}
          >
            {item.meta}
          </span>
        ) : null}
        {chips.map((c) => (
          <span
            key={c.key}
            title={c.title}
            className={cn('shrink-0 rounded-sm px-1 font-mono uppercase tracking-wider', c.className)}
            style={{ fontSize: 9, lineHeight: '15px' }}
          >
            {c.label}
          </span>
        ))}
      </span>
    </button>
  );
}

export function CliPalette({
  open,
  parse,
  items,
  activeId,
  nodeValues,
  radioSettings,
  hops,
  onApply,
  onActivate,
}: CliPaletteProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const width = useWidth(anchorRef);
  const twopane = width >= DETAIL_MIN;
  const groups = groupSuggestions(parse, items);
  // Fall back to the first RENDERED row (groups[0].items[0]), not items[0], so
  // the default highlight matches the top visual row even when grouping reorders.
  const active = items.find((i) => i.id === activeId) ?? groups[0]?.items[0] ?? null;
  const header = parse.mode === 'arg' ? 'Values' : 'Commands';
  const subhead = parse.mode === 'arg' ? parse.cmd.args?.[parse.argIndex]?.name : undefined;

  const activeCmd = active?.cmd;
  const rtLabel =
    activeCmd && radioSettings
      ? cliRoundTrip(active?.label ?? activeCmd.name, radioSettings, hops, !!activeCmd.noReply).label
      : null;
  const activeNodeValue = activeCmd?.key ? nodeValues[activeCmd.key] : undefined;

  // Follow the keyboard: keep the active row visible when ↑/↓ move the selection
  // past the scroll window. block:'nearest' scrolls the listbox the minimal
  // amount and is a no-op when the row is already visible — so hovering (which
  // lands on an already-visible row) never yanks the list. Rows carry id=item.id
  // (getElementById tolerates the ':'/space in the id that querySelector would not).
  const activeOptionId = active?.id;
  useLayoutEffect(() => {
    if (!open || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeOptionId]);

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="pointer-events-none absolute top-0" style={{ left: 8, right: 8, height: 1 }} />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        avoidCollisions={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="overflow-hidden border-cs-border-strong bg-cs-bg-2 p-0 shadow-2xl"
        style={{ width }}
      >
        <div className="flex items-center gap-2 border-b border-cs-border px-2.5 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-cs-text-dim">{header}</span>
          {subhead ? <span className="font-mono text-[10px] text-cs-accent">{subhead}</span> : null}
          <span className="font-mono text-[10px] tabular-nums text-cs-text-dim">{items.length}</span>
          <span className="flex-1" />
          <span className="flex items-center gap-2.5 text-[10px] text-cs-text-dim">
            <span>
              <Kbd>↹</Kbd> complete
            </span>
            <span>
              <Kbd>↑↓</Kbd> move
            </span>
            <span>
              <Kbd>↵</Kbd> run
            </span>
            <span>
              <Kbd>esc</Kbd> dismiss
            </span>
          </span>
        </div>
        <div className="flex">
          <div
            id={CLI_PALETTE_LISTBOX_ID}
            role="listbox"
            aria-label={header}
            aria-activedescendant={active?.id || undefined}
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto p-1"
            style={{ maxHeight: LIST_MAX_H }}
          >
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-cs-text-dim">
                No command matches — press ↵ to send it raw.
              </div>
            ) : (
              groups.map((g, gi) => (
                // biome-ignore lint/a11y/useSemanticElements: visual heading group in the listbox, not a form fieldset
                <div key={g.name ?? `g${gi}`} role="group" aria-label={g.name ?? undefined}>
                  {g.name ? (
                    <div
                      data-group-heading
                      className="px-2 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wider text-cs-text-dim"
                    >
                      {g.name}
                    </div>
                  ) : null}
                  {g.items.map((i) => (
                    <Row
                      key={i.id}
                      item={i}
                      selected={!!active && active.id === i.id}
                      onApply={onApply}
                      onActivate={onActivate}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
          {twopane && active ? (
            <div
              className="shrink-0 overflow-y-auto border-l border-cs-border bg-cs-bg p-3"
              style={{ width: DETAIL_W, maxHeight: LIST_MAX_H }}
            >
              <CliDetail item={active} nodeValue={activeNodeValue} roundTripLabel={rtLabel} />
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
