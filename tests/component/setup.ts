// Setup for the jsdom `dom` Vitest project. @testing-library/react only
// auto-cleans when a global afterEach exists; this project runs without
// `globals: true`, so unmount rendered trees explicitly between tests to keep
// document.body (and our document-level click listeners) from leaking across
// tests.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia. shadcn's SidebarProvider -> useIsMobile
// calls window.matchMedia in an effect, so any component test that mounts the
// sidebar needs a stub.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom doesn't implement ResizeObserver, which Radix's Popover/Popper measures
// with. Any test that opens a Popover (e.g. the macro delete confirmation)
// needs this stub.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't implement Element.scrollIntoView, which cmdk calls from a
// layout effect to keep the selected item in view. Any test that opens a
// `Command` list (e.g. SetPathEditor's Add-hop picker) needs this stub.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Vitest 4's built-in jsdom environment deliberately does not copy
// localStorage/sessionStorage onto globalThis (Node 22+ ships its own gated
// globals under those names, and vitest leaves them alone rather than
// overriding — see populateGlobal's KEYS list in vitest/dist). Node's own
// version needs `--localstorage-file` to actually store anything, so a bare
// `localStorage.setItem(...)` throws "Cannot read properties of undefined".
// Any component test that touches real storage (CliTab's persistence.ts,
// which defaults to globalThis.localStorage when no storage is injected)
// needs the real jsdom Storage wired in — Vitest exposes the live JSDOM
// instance for this file as the global `jsdom`; rebind unconditionally
// (rather than probing `typeof globalThis.localStorage` first) so we never
// trip Node's own one-time "localStorage is not available" warning.
const jsdomInstance = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
if (jsdomInstance) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: jsdomInstance.window.localStorage,
    configurable: true,
  });
}

// Cross-test safety belt: the real jsdom Storage above persists whatever a
// test writes for the lifetime of that test file's jsdom instance. Clear it
// after every test so persisted CLI history / reboot-pending state can't
// leak from one test into the next.
afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // no-op — degrade the same way persistence.ts's resolveStorage does
  }
});
