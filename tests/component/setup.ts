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
