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
