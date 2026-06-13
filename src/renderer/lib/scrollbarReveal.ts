// Discord-style scrollbar auto-hide.
//
// Pure CSS `:hover::-webkit-scrollbar-thumb` is unreliable across the
// virtualized message-list DOM and can't express "reveal while scrolling".
// Instead we tag the *actual* scrolling element with data attributes that the
// stylesheet keys off (see index.css):
//   [data-cs-scroll-hover] — pointer is within the scrollable element
//   [data-cs-scrolling]     — element scrolled within the last HIDE_DELAY ms
// The thumb is transparent unless one of these is present, so it fades in on
// hover or while scrolling and fades back out shortly after the pointer leaves
// or scrolling stops.

const HOVER_ATTR = 'data-cs-scroll-hover';
const SCROLLING_ATTR = 'data-cs-scrolling';
// How long the thumb lingers after the last scroll event before fading out.
const HIDE_DELAY = 1200;

function isScrollable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const canScrollY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
  const canScrollX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth;
  return canScrollY || canScrollX;
}

// Nearest ancestor (including the node itself) that actually scrolls.
function nearestScrollable(node: EventTarget | null): Element | null {
  let el = node instanceof Element ? node : null;
  while (el) {
    if (isScrollable(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/** Wire up scrollbar reveal-on-hover / reveal-on-scroll. Idempotent. */
export function initScrollbarReveal(): void {
  if (window.__csScrollbarReveal) return;
  window.__csScrollbarReveal = true;

  // ---- hover: keep exactly one scrollable element marked at a time ----
  let hovered: Element | null = null;
  const setHovered = (el: Element | null) => {
    if (el === hovered) return;
    hovered?.removeAttribute(HOVER_ATTR);
    hovered = el;
    hovered?.setAttribute(HOVER_ATTR, '');
  };

  // pointerover fires whenever the pointer crosses into a new element, so
  // recomputing the nearest scrollable here tracks the pointer as it moves
  // between panes (message list, sidebar, etc.) or onto non-scrolling chrome.
  window.addEventListener('pointerover', (e) => setHovered(nearestScrollable(e.target)), true);
  // The pointer leaving the window doesn't fire pointerover, so clear here.
  window.addEventListener(
    'pointerout',
    (e) => {
      if ((e as PointerEvent).relatedTarget === null) setHovered(null);
    },
    true,
  );

  // ---- scrolling: mark the scroller, then clear it after a quiet period ----
  const timers = new WeakMap<Element, number>();
  // `scroll` doesn't bubble, but a capturing listener on window still receives
  // it from any descendant scroller — one listener covers every scroll area.
  window.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (!(el instanceof Element)) return;
      el.setAttribute(SCROLLING_ATTR, '');
      const prev = timers.get(el);
      if (prev) clearTimeout(prev);
      timers.set(
        el,
        window.setTimeout(() => el.removeAttribute(SCROLLING_ATTR), HIDE_DELAY),
      );
    },
    true,
  );
}

declare global {
  interface Window {
    __csScrollbarReveal?: boolean;
  }
}
