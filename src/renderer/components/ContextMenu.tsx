import type React from 'react';
import type { MouseEvent } from 'react';
import { useEffect } from 'react';
import { log } from '../lib/logger';
import { cn } from '../lib/utils';

// Reusable right-click context menu. Renders a fixed-position popover at
// (x, y), closes on outside click / Escape, and exposes a small declarative
// API (items + separators) so callers stay terse. Styled with Radix tokens.

/** Icon component type — accepts both lucide-react icons and @radix-ui/react-icons. */
type IconComponent = React.ComponentType<{
  size?: number;
  width?: number | string;
  height?: number | string;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

export interface ContextMenuItem {
  kind?: 'item';
  label: string;
  onClick: () => void;
  icon?: IconComponent;
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
      style={{
        left: x,
        top: y,
        position: 'fixed',
        zIndex: 50,
        minWidth: '11rem',
        padding: '4px 0',
        background: 'var(--color-panel-solid)',
        border: '1px solid var(--gray-a5)',
        borderRadius: 'var(--radius-3)',
        boxShadow: 'var(--shadow-4)',
      }}
      onMouseDown={stopPropagation}
    >
      {items.map((entry, i) => {
        if (entry.kind === 'separator') {
          // biome-ignore lint/suspicious/noArrayIndexKey: separator position within a static items array is the only stable id
          return <div key={`sep-${i}`} style={{ margin: '4px 0', height: 1, background: 'var(--gray-a4)' }} />;
        }
        return <ContextMenuItemRow key={entry.label} entry={entry} onClose={onClose} />;
      })}
    </div>
  );
}

function ContextMenuItemRow({ entry, onClose }: { entry: ContextMenuItem; onClose: () => void }) {
  const Icon = entry.icon;
  const colorStyle: React.CSSProperties = entry.disabled
    ? { color: 'var(--gray-a8)', cursor: 'not-allowed', opacity: 0.6 }
    : entry.danger
      ? { color: 'var(--red-11)' }
      : { color: 'var(--gray-11)' };
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
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        !entry.disabled && (entry.danger ? 'hover:bg-(--red-a3)' : 'hover:bg-(--gray-a3)'),
      )}
      style={colorStyle}
    >
      {Icon && <Icon size={11} width={11} height={11} aria-hidden="true" className="shrink-0" />}
      <span className="flex-1 truncate">{entry.label}</span>
      {entry.hint && <span style={{ fontSize: 10, color: 'var(--gray-a8)' }}>{entry.hint}</span>}
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
