import type { LucideIcon } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect } from 'react';
import { log } from '../lib/logger';
import { cn } from '../lib/utils';

// Reusable right-click context menu. Renders a fixed-position popover at
// (x, y), closes on outside click / Escape, and exposes a small declarative
// API (items + separators) so callers stay terse. No radix / shadcn dep.

export interface ContextMenuItem {
  kind?: 'item';
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
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

export function ContextMenu({ x, y, items, onClose }: Props) {
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
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-44 rounded-md border border-cs-border bg-cs-bg-2 py-1 text-xs shadow-lg"
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
