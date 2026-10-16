import { createContext, type ReactNode, useContext, useEffect } from 'react';
import type { ApiClient } from './api';

// The renderer's one ApiClient, built by App from the probed base URL and the
// API key. It is null until both are known (and stays null in a browser that
// has not been given a key), so every consumer must handle the null case —
// exactly as it did when the client arrived as a prop.
const ApiClientContext = createContext<ApiClient | null>(null);

// Non-React callers (the menu-action dispatcher, which runs off a WS message
// rather than a render) cannot read context, so the provider mirrors the
// current client into this module-level holder. Read it at call time, never at
// module load or factory-creation time, so a later base URL or key is picked up.
let currentClient: ApiClient | null = null;

/** The current ApiClient for code that runs outside React (menu actions). */
export function getApiClient(): ApiClient | null {
  return currentClient;
}

/** Replace the holder's client. ApiClientProvider calls this; tests of
 *  non-React callers may call it directly. */
export function setApiClient(client: ApiClient | null): void {
  currentClient = client;
}

/** Provides `client` to useApiClient() below it, and mirrors it into the
 *  getApiClient() holder. App renders exactly one of these. */
export function ApiClientProvider({ client, children }: { client: ApiClient | null; children: ReactNode }) {
  useEffect(() => {
    setApiClient(client);
    return () => {
      // Only clear our own value: a remount with a new client sets its own.
      if (currentClient === client) setApiClient(null);
    };
  }, [client]);
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

/** Renders `children` as if no client were available (useApiClient() returns
 *  null below it), without touching the getApiClient() holder. For display-only
 *  subtrees that reuse an interactive component. */
export function NoApiClient({ children }: { children: ReactNode }) {
  return <ApiClientContext.Provider value={null}>{children}</ApiClientContext.Provider>;
}

/** The current ApiClient, or null while the base URL / API key are unknown. */
export function useApiClient(): ApiClient | null {
  return useContext(ApiClientContext);
}
