import { useEffect, useState } from 'react';
import { useStore } from '../../lib/store';

/** How long the width must hold still before we call the drag finished. Short
 *  enough that a released drag re-measures before the user can look at it, long
 *  enough that no in-flight drag frame ever reaches the roster. */
const SETTLE_MS = 120;

/** The rail's px width, but only once it has stopped changing for ~120ms.
 *
 *  Sections must not select `ui.rightWidth` directly (see `railIsWide`), yet a
 *  couple of consumers genuinely need the number rather than the breakpoint —
 *  `PeopleRow` re-measures whether its name is clipped, which depends on the
 *  actual column width. This gives them a value that changes once per drag
 *  instead of once per frame.
 *
 *  Deliberately an imperative `useStore.subscribe` rather than a selector: a
 *  selector would re-render this hook's owner on every frame, which is the exact
 *  cost we are removing. And deliberately rail-local — no new `UiState` field,
 *  and no per-row `ResizeObserver` (there can be 577 rows). */
export function useSettledRailWidth(): number {
  const [settled, setSettled] = useState(() => useStore.getState().ui.rightWidth);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useStore.subscribe((state, prev) => {
      const next = state.ui.rightWidth;
      if (next === prev.ui.rightWidth) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSettled(next), SETTLE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return settled;
}
