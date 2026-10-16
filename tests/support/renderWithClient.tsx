import { type RenderOptions, render, renderHook } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import type { ApiClient } from '../../src/renderer/lib/api';
import { ApiClientProvider } from '../../src/renderer/lib/apiClientContext';
import { TEST_CLIENT } from './apiClient';

// Components read the ApiClient from context (useApiClient) rather than a
// prop, so a test that wants one mounts the tree under the same provider App
// uses. A test that wants no client just renders without these helpers: the
// context defaults to null. Kept apart from ./apiClient so node-only unit tests
// can import TEST_CLIENT without pulling in React Testing Library.

/** A render/renderHook `wrapper` providing `client` to useApiClient(). */
export function clientWrapper(client: ApiClient | null = TEST_CLIENT) {
  return function ClientWrapper({ children }: { children: ReactNode }) {
    return <ApiClientProvider client={client}>{children}</ApiClientProvider>;
  };
}

/** RTL `render` with the tree under an ApiClientProvider (TEST_CLIENT by
 *  default). `rerender` keeps the wrapper. */
export function renderWithClient(
  ui: ReactElement,
  { client = TEST_CLIENT, ...options }: Omit<RenderOptions, 'wrapper'> & { client?: ApiClient | null } = {},
) {
  return render(ui, { ...options, wrapper: clientWrapper(client) });
}

/** RTL `renderHook` with the hook under an ApiClientProvider. */
export function renderHookWithClient<Result>(hook: () => Result, client: ApiClient | null = TEST_CLIENT) {
  return renderHook(hook, { wrapper: clientWrapper(client) });
}
