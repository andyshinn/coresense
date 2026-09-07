import { useCallback, useEffect, useRef } from 'react';

const MIN_WIDTH = 240;
const MAX_WIDTH = 640;

/** Drag handle on the rail's left edge; clamps width and cancels on Esc.
 *
 *  `onChange` is `setRightWidth`, i.e. a store write that reconciles the whole
 *  rail. A pointing device reports moves considerably faster than the
 *  compositor paints (high-polling mice fire several per frame), so publishing
 *  one width per pointermove burns work no one ever sees. Every move is
 *  therefore coalesced into a single `onChange` per animation frame carrying the
 *  newest position — the width still tracks the pointer live (two sections do
 *  layout math off `ui.rightWidth`, and Esc-cancel has no restore path, so the
 *  write cannot be deferred to pointerup), it just stops being published more
 *  often than it can be drawn. See issue #35. */
export function ResizeHandle({ width, onChange }: { width: number; onChange: (w: number) => void }) {
  const startRef = useRef<{ x: number; w: number } | null>(null);
  /** Newest clamped width awaiting publication, and the frame that will publish it. */
  const pendingRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  // The scheduled frame outlives the render that scheduled it, so read the
  // callback through a ref rather than closing over a possibly stale one.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const discardPending = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, w: width };
    },
    [width],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    // Width grows as the pointer moves leftward (handle is on the rail's left edge).
    const delta = startRef.current.x - e.clientX;
    pendingRef.current = clamp(startRef.current.w + delta, MIN_WIDTH, MAX_WIDTH);
    if (frameRef.current !== null) return; // a frame is already queued; it will pick up the newer value
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const next = pendingRef.current;
      pendingRef.current = null;
      // Esc (or an unmount) between the move and the frame ends the drag; don't
      // publish a width the user has already backed out of.
      if (next !== null && startRef.current) onChangeRef.current(next);
    });
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      // Flush the last coalesced move before ending the drag, so releasing
      // mid-frame lands on the pointer rather than up to one frame behind it.
      const pending = pendingRef.current;
      const dragging = startRef.current !== null;
      discardPending();
      startRef.current = null;
      if (dragging && pending !== null) onChangeRef.current(pending);
    },
    [discardPending],
  );

  // Esc cancels an in-progress drag. The pending frame is dropped rather than
  // flushed — cancelling must not publish one more width.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      startRef.current = null;
      discardPending();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [discardPending]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only cleanup; discardPending is referentially stable
  useEffect(() => () => discardPending(), []);

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
