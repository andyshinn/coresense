import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';

/** How long the width must hold still before we call the drag finished. Short
 *  enough that a released drag re-measures before the user can look at it, long
 *  enough that no in-flight drag frame ever reaches the roster. */
const SETTLE_MS = 120;

/** Increments once every time the rail's width stops changing for ~120ms.
 *
 *  Sections must not select `ui.rightWidth` directly (see `railIsWide`), yet a
 *  couple of consumers genuinely need to redo work that depends on the actual
 *  px width — `PeopleRow` re-measures whether its name is clipped, which
 *  depends on the real column width. This gives them a signal that fires once
 *  per drag instead of once per frame.
 *
 *  A COUNTER, deliberately, rather than the settled width itself. Consumers use
 *  this only as an effect dependency, and the two rail clamps (MIN_WIDTH 240 /
 *  MAX_WIDTH 640 in ResizeHandle) make "the drag ended on the width it started
 *  on" an ordinary gesture rather than a pixel coincidence: drag past either
 *  stop and release, and the published width is the clamp again. Publishing the
 *  value would make React bail on that no-op `setState`, so no re-measure would
 *  run — even though the drag crossed the 304px breakpoint on the way and left
 *  every row's `clipped` flag measured against a width the rail no longer has.
 *  A counter always changes, so every settled drag re-measures exactly once.
 *
 *  Deliberately an imperative `useStore.subscribe` rather than a selector: a
 *  selector would re-render this hook's owner on every frame, which is the exact
 *  cost we are removing. And deliberately rail-local — no new `UiState` field,
 *  and no per-row `ResizeObserver` (there can be 577 rows). */
export function useRailSettleTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useStore.subscribe((state, prev) => {
      if (state.ui.rightWidth === prev.ui.rightWidth) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setTick((n) => n + 1), SETTLE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return tick;
}
