import { useCallback, useEffect, useRef } from 'react';

const MIN_WIDTH = 240;
const MAX_WIDTH = 640;

/** Drag handle on the rail's left edge; clamps width and cancels on Esc. */
export function ResizeHandle({
  width,
  onChange,
}: {
  width: number;
  onChange: (w: number) => void;
}) {
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, w: width };
    },
    [width],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!startRef.current) return;
      // Width grows as the pointer moves leftward (handle is on the rail's left edge).
      const delta = startRef.current.x - e.clientX;
      const next = clamp(startRef.current.w + delta, MIN_WIDTH, MAX_WIDTH);
      onChange(next);
    },
    [onChange],
  );
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    startRef.current = null;
  }, []);

  // Esc cancels an in-progress drag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') startRef.current = null;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
    />
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
