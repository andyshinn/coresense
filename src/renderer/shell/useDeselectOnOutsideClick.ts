import { useEffect } from 'react';
import { useStore } from '../lib/store';

// Selectors that mean "this click is on/inside something we must NOT deselect
// for": a message row (its own onClick handles selecting it) and anywhere inside
// the detail rail (so reading/acting on the detail doesn't dismiss it).
const KEEP_SELECTION_SELECTORS = ['[data-testid="message-row"]', '[aria-label="Detail rail"]'];

// Deselect the active message when the user clicks anywhere off it — empty
// space, the composer, the left nav, etc. Read/write the store via getState() so
// this listener never re-subscribes.
//
// We decide inside/outside from event.composedPath() rather than
// target.closest(). This document "click" listener fires after React has handled
// the same click and synchronously re-rendered. Some rail controls — a path
// row's expand/collapse chevron (PathItem/HopRow) — render
// `{open ? <ChevronDown/> : <ChevronRight/>}`, so toggling swaps one lucide
// component for a *different* one and React unmounts the exact node that was
// clicked. A detached node has no ancestors, so target.closest('…Detail rail…')
// would return null and we'd wrongly treat an in-rail click as "outside" and
// deselect. composedPath() is frozen at dispatch time, so it still holds the
// clicked node's original ancestor chain (including the [aria-label="Detail
// rail"] aside) even after the node detaches.
export function useDeselectOnOutsideClick() {
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (useStore.getState().selectedMessageId == null) return;
      for (const node of e.composedPath()) {
        // composedPath() includes non-Element targets (window, document) that
        // have no matches() — skip them.
        if (typeof (node as Element).matches !== 'function') continue;
        const el = node as Element;
        if (KEEP_SELECTION_SELECTORS.some((sel) => el.matches(sel))) return;
      }
      useStore.getState().setSelectedMessage(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);
}
