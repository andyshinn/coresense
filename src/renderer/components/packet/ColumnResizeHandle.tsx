import { useCallback, useEffect, useRef } from 'react';
import { clampColumnWidth, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from '../../lib/packetLogColumns';

/** Drag handle on a Packet Log header cell's edge. `edge` is the side it sits on:
 *  dragging a right-edge handle rightward widens its column, a left-edge handle
 *  leftward. Esc cancels a drag; double-click resets the column. When focused, the
 *  arrow keys widen and narrow it in the same screen direction as a drag. */
export function ColumnResizeHandle({
  edge,
  label,
  width,
  resized,
  onChange,
  onReset,
}: {
  edge: 'left' | 'right';
  label: string;
  width: number;
  /** Whether the column already has a dragged width, so Esc restores exactly that. */
  resized: boolean;
  onChange: (width: number) => void;
  onReset: () => void;
}) {
  const startRef = useRef<{ x: number; w: number; resized: boolean } | null>(null);
  const callbacks = useRef({ onChange, onReset });
  callbacks.current = { onChange, onReset };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, w: width, resized };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start) return;
    const delta = (e.clientX - start.x) * (edge === 'right' ? 1 : -1);
    onChange(clampColumnWidth(start.w + delta));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    startRef.current = null;
    // Last, as in the rail's ResizeHandle: it can throw if the pointer is gone.
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const outward = (e.key === 'ArrowRight') === (edge === 'right');
    onChange(clampColumnWidth(width + (outward ? 8 : -8)));
  };

  const cancel = useCallback((e: KeyboardEvent) => {
    const start = startRef.current;
    if (e.key !== 'Escape' || !start) return;
    // A column that was still at its default goes back to it (so Time keeps fitting the format).
    if (start.resized) callbacks.current.onChange(start.w);
    else callbacks.current.onReset();
    startRef.current = null;
  }, []);
  useEffect(() => {
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [cancel]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> can't be dragged; a focusable separator is the ARIA pattern for a splitter.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuenow={width}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      // Resizing is not a click "outside" the selected packet; keep it from reaching
      // the document-level deselect listener.
      onClick={(e) => e.stopPropagation()}
      className={`absolute -top-1.5 -bottom-1.5 z-10 w-2 cursor-col-resize hover:bg-cs-accent/40 focus-visible:bg-cs-accent/60 focus-visible:outline-none ${edge === 'right' ? '-right-[8px]' : '-left-[8px]'}`}
    />
  );
}
