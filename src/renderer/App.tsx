import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../shared/errors';
import { createMenuActionHandler } from './app/menuActions';
import { resolveBaseUrl } from './app/resolveBaseUrl';
import { useDraftsPersistence } from './app/useDraftsPersistence';
import { useUiStatePersistence } from './app/useUiStatePersistence';
import { createWsMessageHandler } from './app/wsHandlers';
import { ApiKeyGate } from './components/ApiKeyGate';
import { PacketLogHost, PathLearnedDialogHost, StatusBarHost } from './components/AppHosts';
import { PacketDecoderDialog } from './components/packet/PacketDecoderDialog';
import { Toaster } from './components/ui/sonner';
import { CommandPalette } from './features/command-palette';
import { ShortcutsHelpDialog } from './features/help-overlay';
import { useWebSocket } from './hooks/useWebSocket';
import { type ApiClient, api, fetchCapabilities } from './lib/api';
import { ApiClientProvider } from './lib/apiClientContext';
import { loadApiKey, saveApiKey } from './lib/apiKey';
import { notify } from './lib/notify';
import { dispatchShortcut } from './lib/shortcut-dispatch';
import { useStore } from './lib/store';
import { applyTheme, clearLegacyThemePref, readLegacyThemePref, resolveTheme, type ThemePref } from './lib/theme';
import { AppShell } from './shell/AppShell';

// Lazy: MainPane drags in every panel module (~1.5k LOC of forms/tables that
// aren't used until the user navigates to them).
const MainPane = lazy(() => import('./shell/MainPane').then((m) => ({ default: m.MainPane })));

export function App() {
  // The Electron preload injects `window.coresense.apiKey` — the first-party
  // window gets the key for free. A plain browser has no preload, so it falls
  // back to localStorage and, failing that, the ApiKeyGate.
  const [apiKey, setApiKey] = useState<string | null>(() => window.coresense?.apiKey ?? loadApiKey());
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [port, setPort] = useState<number | null>(null);
  // config.json path, surfaced to the ApiKeyGate so a browser user knows
  // exactly where to read the key. Populated by the capabilities probe.
  const [configPath, setConfigPath] = useState<string | null>(null);
  const themePref = useStore((s) => s.ui.themePref);
  const setThemePrefStore = useStore((s) => s.setThemePref);
  // systemDark lives in the store so any component (MapCanvas et al.) can
  // resolve the effective theme without prop-drilling. Seeded synchronously
  // in the store from matchMedia; main pushes updates via the 'theme' WS event.
  const systemDark = useStore((s) => s.systemDark);
  const setSystemDark = useStore((s) => s.setSystemDark);
  const [hydrated, setHydrated] = useState(false);

  // Action references are stable across renders (zustand returns the same
  // function instance) — pulling them via getState() inside callbacks avoids
  // subscribing App to every store mutation.
  const hydrate = useStore((s) => s.hydrate);
  const setBusy = useStore((s) => s.setBusy);
  const toggleLeftNav = useStore((s) => s.toggleLeftNav);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const togglePin = useStore((s) => s.togglePin);
  const setActiveKey = useStore((s) => s.setActiveKey);

  useEffect(() => {
    applyTheme(resolveTheme(themePref, systemDark));
  }, [themePref, systemDark]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
    // setSystemDark is a stable store action — including it just to satisfy
    // the linter is the cheapest path forward.
  }, [setSystemDark]);

  // Global keyboard shortcuts. The native menu accelerators handle the
  // menu-surface bindings even when an input is focused; this listener owns the
  // renderer-surface ones (Quick find, Help, unread-nav, ⌘1-9, Mark all read).
  // See src/shared/shortcuts.ts for the single source of truth.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (dispatchShortcut(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Mouse XButton1/XButton2 (back/forward side buttons) come through as
  // mousedown with button 3/4 in the renderer. On Windows/Linux these ALSO
  // fire app-command in main, but the renderer side is essential on macOS
  // where app-command isn't emitted for mouse buttons. mousedown fires before
  // any click handler can preventDefault, so this is reliably the first event.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        useStore.getState().goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        useStore.getState().goForward();
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, []);

  const cycleThemePref = useCallback(() => {
    const prev = useStore.getState().ui.themePref;
    const next: ThemePref = prev === 'auto' ? 'dark' : prev === 'dark' ? 'light' : 'auto';
    setThemePrefStore(next);
  }, [setThemePrefStore]);

  const handleMenuAction = useMemo(
    () =>
      createMenuActionHandler({
        cycleThemePref,
        toggleLeftNav,
        toggleRightRail,
        togglePin,
        setActiveKey,
      }),
    [cycleThemePref, toggleLeftNav, toggleRightRail, togglePin, setActiveKey],
  );

  useEffect(() => {
    // First-party window: preload tells us the exact port our own server bound,
    // so a dev instance (7754) and an installed one (7654) never cross wires —
    // and `fallback` is null, because retrying the well-known port would attach
    // this window to some *other* CoreSense instance (issue #21).
    const { candidate, fallback } = resolveBaseUrl(window.coresense?.httpPort, window.location);
    void (async () => {
      let lastErr: unknown;
      for (const url of fallback ? [candidate, fallback] : [candidate]) {
        try {
          const caps = await fetchCapabilities(url);
          setBaseUrl(url);
          setPort(caps.httpPort);
          setConfigPath(caps.configPath);
          return;
        } catch (err) {
          lastErr = err;
        }
      }
      notify.error(`Could not reach CoreSense server: ${errorMessage(lastErr)}`, lastErr);
    })();
  }, []);

  // Built once here and provided to the whole tree by ApiClientProvider below;
  // components read it with useApiClient(), the menu-action handler with
  // getApiClient(). App itself sits above the provider, so it uses this value.
  const client: ApiClient | null = useMemo(() => (baseUrl && apiKey ? { baseUrl, apiKey } : null), [baseUrl, apiKey]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void (async () => {
      try {
        const snap = await api.snapshot(client);
        if (!cancelled) {
          hydrate(snap);
          setHydrated(true);
        }
      } catch (err) {
        if (!cancelled) notify.failure('Snapshot fetch', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, hydrate]);

  // One-shot migration: if a legacy localStorage theme pref exists and the
  // hydrated ui.themePref is still the default 'auto', adopt the legacy value
  // and clear the localStorage key. Drop this branch in a follow-up release.
  useEffect(() => {
    if (!hydrated) return;
    const legacy = readLegacyThemePref();
    if (!legacy) return;
    if (useStore.getState().ui.themePref === 'auto' && legacy !== 'auto') {
      setThemePrefStore(legacy);
    }
    clearLegacyThemePref();
  }, [hydrated, setThemePrefStore]);

  // Debounced persistence of UI state changes to ui-state.json. Subscribes to
  // the store outside the render cycle — see the hook for why reading `ui`
  // through useStore here made every keystroke re-render the whole app.
  useUiStatePersistence(client, hydrated);
  // Drafts persist separately, on boundaries rather than a timer — see the hook.
  useDraftsPersistence(client, hydrated);

  const wsUrl = useMemo(() => {
    if (!baseUrl || !apiKey) return null;
    const url = new URL(baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    url.searchParams.set('key', apiKey);
    return url.toString();
  }, [baseUrl, apiKey]);

  const onMessage = useMemo(
    () => createWsMessageHandler({ setSystemDark, handleMenuAction }),
    [handleMenuAction, setSystemDark],
  );

  useWebSocket({ url: wsUrl, onMessage });

  // Scan, connect and disconnect share one shape: busy for the duration of the
  // call, and a toast on failure.
  const runBusy = useCallback(
    async (op: (c: ApiClient) => Promise<unknown>) => {
      if (!client) return;
      setBusy(true);
      try {
        await op(client);
      } catch (err) {
        notify.error(errorMessage(err), err);
      } finally {
        setBusy(false);
      }
    },
    [client, setBusy],
  );
  const handleScan = useCallback(() => runBusy((c) => api.scan(c)), [runBusy]);
  const handleConnect = useCallback((deviceId: string) => runBusy((c) => api.connect(c, deviceId)), [runBusy]);
  const handleDisconnect = useCallback(() => runBusy((c) => api.disconnect(c)), [runBusy]);

  if (!apiKey) {
    return (
      <AppShell showShell={false}>
        <Toaster richColors closeButton position="bottom-right" />
        <div className="flex flex-1 items-center justify-center">
          <ApiKeyGate
            configPath={configPath}
            onSubmit={(key) => {
              saveApiKey(key);
              setApiKey(key);
            }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <ApiClientProvider client={client}>
      <AppShell>
        <Toaster richColors closeButton position="bottom-right" />
        <CommandPalette cycleThemePref={cycleThemePref} />
        <ShortcutsHelpDialog />
        <PacketDecoderDialog />
        <PathLearnedDialogHost />
        <div className="flex h-full flex-1 flex-col">
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={null}>
              <MainPane
                onScan={handleScan}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                renderPacketLog={() => (
                  <Suspense fallback={null}>
                    <PacketLogHost />
                  </Suspense>
                )}
              />
            </Suspense>
          </div>

          <StatusBarHost port={port} />
        </div>
      </AppShell>
    </ApiClientProvider>
  );
}
