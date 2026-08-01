import type { LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { log } from '../lib/logger';
import { cn } from '../lib/utils';

// Reusable right-click context menu. Renders a fixed-position popover at
// (x, y), flipped and clamped to stay inside the window, closes on outside
// click / Escape, and exposes a small declarative API (items + separators) so
// callers stay terse. No radix / shadcn dep.

export interface ContextMenuItem {
  kind?: 'item';
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
  /** Optional test anchor forwarded as `data-testid` on the rendered menu button. */
  testid?: string;
}

export interface ContextMenuSeparator {
  kind: 'separator';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface Props {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

/** Gap kept between the menu and the window edge (the collision padding). */
const EDGE_PADDING = 8;

export interface MenuPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * Positions a `w`×`h` menu opened at (x, y) inside a `vw`×`vh` window: flips it
 * to the other side of the cursor when it would overflow, then clamps so it can
 * never start off-screen, and caps its height so a menu taller than the window
 * scrolls instead of spilling.
 *
 * Exported for tests — jsdom reports every element as 0×0, so this arithmetic
 * cannot be exercised through a render.
 */
export function placeMenu(x: number, y: number, w: number, h: number, vw: number, vh: number): MenuPlacement {
  // Flip first — anchoring the far edge to the cursor is what a native context
  // menu does — then clamp, which is what rescues a menu bigger than the window
  // (its flipped origin lands negative).
  const flippedLeft = x + w > vw - EDGE_PADDING ? x - w : x;
  const flippedTop = y + h > vh - EDGE_PADDING ? y - h : y;
  return {
    left: Math.max(EDGE_PADDING, Math.min(flippedLeft, vw - w - EDGE_PADDING)),
    top: Math.max(EDGE_PADDING, Math.min(flippedTop, vh - h - EDGE_PADDING)),
    maxHeight: Math.max(0, vh - EDGE_PADDING * 2),
  };
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  // Measure-then-place, in a layout effect so the corrected position is applied
  // before the browser paints — the first render at the raw cursor coords is
  // never visible. Measured once per open position: `items` is fixed for a
  // menu's lifetime (it's rebuilt on the next right-click, which moves x/y).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPlacement(placeMenu(x, y, width, height, window.innerWidth, window.innerHeight));
  }, [x, y]);

  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer so the right-click that opened the menu doesn't immediately
    // close it via the mousedown handler.
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const stopPropagation = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={ref}
      role="menu"
      // Before the first measure this is the raw cursor point, which is also
      // what the measure needs — placement only shifts the box, never resizes it.
      style={{ left: placement?.left ?? x, top: placement?.top ?? y, maxHeight: placement?.maxHeight }}
      className="fixed z-50 min-w-44 overflow-y-auto rounded-md border border-cs-border bg-cs-bg-2 py-1 text-xs shadow-lg"
      onMouseDown={stopPropagation}
    >
      {items.map((entry, i) => {
        if (entry.kind === 'separator') {
          // biome-ignore lint/suspicious/noArrayIndexKey: separator position within a static items array is the only stable id
          return <div key={`sep-${i}`} className="my-1 h-px bg-cs-border" />;
        }
        return <ContextMenuItemRow key={entry.label} entry={entry} onClose={onClose} />;
      })}
    </div>
  );
}

function ContextMenuItemRow({ entry, onClose }: { entry: ContextMenuItem; onClose: () => void }) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={entry.testid}
      disabled={entry.disabled}
      onClick={() => {
        if (entry.disabled) return;
        entry.onClick();
        onClose();
      }}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
        entry.disabled
          ? 'cursor-not-allowed text-cs-text-dim opacity-60'
          : entry.danger
            ? 'text-cs-danger hover:bg-cs-danger/10'
            : 'text-cs-text-muted hover:bg-cs-bg-3 hover:text-cs-text',
      )}
    >
      {Icon && <Icon size={11} aria-hidden="true" className="shrink-0" />}
      <span className="flex-1 truncate">{entry.label}</span>
      {entry.hint && <span className="text-[10px] text-cs-text-dim">{entry.hint}</span>}
    </button>
  );
}

// Helper for callers: builds a ContextMenuItem with sensible defaults.
export function menuItem(
  label: string,
  onClick: () => void,
  extra: Partial<Omit<ContextMenuItem, 'label' | 'onClick' | 'kind'>> = {},
): ContextMenuItem {
  return { kind: 'item', label, onClick, ...extra };
}

export const menuSeparator: ContextMenuSeparator = { kind: 'separator' };

// Convenience for clipboard copies — used by Copy items across menus.
// `onDone` fires only on a confirmed write, so callers can key success UI
// (toast / "Copied!" popover) off it. Failures are logged rather than swallowed
// so a broken clipboard is debuggable from the DevTools console.
export function copyToClipboard(text: string, onDone?: () => void): void {
  if (!navigator.clipboard) {
    log.error('Clipboard write failed: navigator.clipboard is unavailable (insecure context?)');
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => onDone?.(),
    (err) => log.error('Clipboard write failed', err),
  );
}
