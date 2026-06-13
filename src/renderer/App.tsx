import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiState } from '../shared/types';
import { createMenuActionHandler } from './app/menuActions';
import { createWsMessageHandler } from './app/wsHandlers';
import { ApiKeyGate } from './components/ApiKeyGate';
import { PacketLogHost, PathLearnedDialogHost, StatusBarHost } from './components/AppHosts';
import { Toaster } from './components/ui/sonner';
import { CommandPalette } from './features/command-palette';
import { ShortcutsHelpDialog } from './features/help-overlay';
import { useWebSocket } from './hooks/useWebSocket';
import { type ApiClient, api, fetchCapabilities } from './lib/api';
import { loadApiKey, saveApiKey } from './lib/apiKey';
import { notify } from './lib/notify';
import { dispatchShortcut } from './lib/shortcut-dispatch';
import { useStore } from './lib/store';
import { applyTheme, clearLegacyThemePref, readLegacyThemePref, resolveTheme, type ThemePref } from './lib/theme';
import { AppShell } from './shell/AppShell';

// Lazy: MainPane drags in every panel module (~1.5k LOC of forms/tables that
// aren't used until the user navigates to them).
const MainPane = lazy(() => import('./shell/MainPane').then((m) => ({ default: m.MainPane })));

const UI_STATE_DEBOUNCE_MS = 500;
const FALLBACK_BASE_URL = 'http://127.0.0.1:7654';

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

  const ui = useStore((s) => s.ui);

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
        baseUrl,
        apiKey,
        cycleThemePref,
        toggleLeftNav,
        toggleRightRail,
        togglePin,
        setActiveKey,
      }),
    [cycleThemePref, toggleLeftNav, toggleRightRail, togglePin, setActiveKey, baseUrl, apiKey],
  );

  useEffect(() => {
    // First-party window: preload tells us the exact server port. Skip the
    // probe entirely so dev (7754+) and prod (7654+) instances never collide.
    const injectedPort = window.coresense?.httpPort;
    const candidate = injectedPort
      ? `http://127.0.0.1:${injectedPort}`
      : window.location.protocol.startsWith('http')
        ? `${window.location.protocol}//${window.location.host}`
        : FALLBACK_BASE_URL;
    void (async () => {
      try {
        const caps = await fetchCapabilities(candidate);
        setBaseUrl(candidate);
        setPort(caps.httpPort);
        setConfigPath(caps.configPath);
      } catch {
        try {
          const caps = await fetchCapabilities(FALLBACK_BASE_URL);
          setBaseUrl(FALLBACK_BASE_URL);
          setPort(caps.httpPort);
          setConfigPath(caps.configPath);
        } catch (err) {
          notify.error(`Could not reach CoreSense server: ${(err as Error).message}`, err);
        }
      }
    })();
  }, []);

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
        if (!cancelled) notify.error(`Snapshot fetch failed: ${(err as Error).message}`, err);
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

  // Debounced persistence of UI state changes to ui-state.json. Skipped until
  // the first snapshot arrives so we don't overwrite the on-disk version with
  // the in-memory default.
  const lastSentRef = useRef<UiState | null>(null);
  useEffect(() => {
    if (!client || !hydrated) return;
    if (lastSentRef.current === ui) return;
    const handle = setTimeout(() => {
      lastSentRef.current = ui;
      void api.putUiState(client, ui).catch(() => {
        // Non-fatal; renderer state is the source of truth for this session.
      });
    }, UI_STATE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [ui, client, hydrated]);

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

  const handleScan = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      await api.scan(client);
    } catch (err) {
      notify.error((err as Error).message, err);
    } finally {
      setBusy(false);
    }
  }, [client, setBusy]);

  const handleConnect = useCallback(
    async (deviceId: string) => {
      if (!client) return;
      setBusy(true);
      try {
        await api.connect(client, deviceId);
      } catch (err) {
        notify.error((err as Error).message, err);
      } finally {
        setBusy(false);
      }
    },
    [client, setBusy],
  );

  const handleDisconnect = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      await api.disconnect(client);
    } catch (err) {
      notify.error((err as Error).message, err);
    } finally {
      setBusy(false);
    }
  }, [client, setBusy]);

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
    <AppShell client={client}>
      <Toaster richColors closeButton position="bottom-right" />
      <CommandPalette client={client} cycleThemePref={cycleThemePref} />
      <ShortcutsHelpDialog />
      <PathLearnedDialogHost client={client} />
      <div className="flex h-full flex-1 flex-col">
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={null}>
            <MainPane
              client={client}
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
  );
}
