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
