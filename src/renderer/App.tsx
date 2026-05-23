import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuAction, UiState, WsMessage } from '../shared/types';
import { ApiKeyGate } from './components/ApiKeyGate';
import { PathLearnedDialog } from './components/path/PathLearnedDialog';
import { StatusBar } from './components/StatusBar';
import { Toaster } from './components/ui/sonner';
import { CommandPalette } from './features/CommandPalette';
import { useWebSocket } from './hooks/useWebSocket';
import { type ApiClient, api, fetchCapabilities } from './lib/api';
import { loadApiKey, saveApiKey } from './lib/apiKey';
import { notify } from './lib/notify';
import { useStore } from './lib/store';
import {
  applyTheme,
  clearLegacyThemePref,
  readLegacyThemePref,
  resolveTheme,
  type ThemePref,
} from './lib/theme';
import { AppShell } from './shell/AppShell';

// Lazy: MainPane drags in every panel module (~1.5k LOC of forms/tables that
// aren't used until the user navigates to them).
const MainPane = lazy(() => import('./shell/MainPane').then((m) => ({ default: m.MainPane })));
// Lazy: PacketLog pulls in react-virtual + the protocol decoder; we only need
// it when the user opens the packet log panel.
const PacketLog = lazy(() =>
  import('./components/PacketLog').then((m) => ({ default: m.PacketLog })),
);

const UI_STATE_DEBOUNCE_MS = 500;
const FALLBACK_BASE_URL = 'http://127.0.0.1:7654';

export function App() {
  // The Electron preload injects `window.coresense.apiKey` — the first-party
  // window gets the key for free. A plain browser has no preload, so it falls
  // back to localStorage and, failing that, the ApiKeyGate.
  const [apiKey, setApiKey] = useState<string | null>(
    () => window.coresense?.apiKey ?? loadApiKey(),
  );
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

  // Global Cmd/Ctrl+K listener. The menu accelerator handles it when nothing
  // else has focus, but a focused input swallows the keydown — this captures
  // the bubbled event so the palette opens regardless of focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        useStore.getState().openPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const cycleThemePref = useCallback(() => {
    const prev = useStore.getState().ui.themePref;
    const next: ThemePref = prev === 'auto' ? 'dark' : prev === 'dark' ? 'light' : 'auto';
    setThemePrefStore(next);
  }, [setThemePrefStore]);

  const handleMenuAction = useCallback(
    (action: MenuAction) => {
      switch (action.kind) {
        case 'cycleTheme':
          cycleThemePref();
          break;
        case 'openPalette':
          useStore.getState().openPalette();
          break;
        case 'focusKey':
          setActiveKey(action.key);
          break;
        case 'toggleLeftNav':
          toggleLeftNav();
          break;
        case 'toggleRightRail':
          toggleRightRail();
          break;
        case 'openSettings':
          setActiveKey('tool:settings:app');
          break;
        case 'requestQuit': {
          // Main deferred a quit/close. If a Settings section is dirty, raise
          // the unsaved-changes dialog; otherwise tell main it's safe to quit.
          const st = useStore.getState();
          const dirty = Object.values(st.settingsUi.dirtyById).some(Boolean);
          if (dirty) {
            st.setPendingTarget({ kind: 'quit' });
          } else if (baseUrl && apiKey) {
            void api.confirmQuit({ baseUrl, apiKey });
          }
          break;
        }
        case 'pinToggle': {
          const key = useStore.getState().ui.activeKey;
          if (key.startsWith('ch:') || key.startsWith('c:')) togglePin(key);
          break;
        }
        case 'sendAdvert': {
          if (!baseUrl || !apiKey) break;
          void api.sendAdvert({ baseUrl, apiKey }).then(
            () => notify.success('Self-advert sent'),
            (err) => notify.error(`Advert failed: ${(err as Error).message}`, err),
          );
          break;
        }
        case 'cyclePinned': {
          const state = useStore.getState();
          const pinned = state.ui.pinned;
          if (pinned.length === 0) break;
          const i = pinned.indexOf(state.ui.activeKey);
          const next =
            action.direction === 'next'
              ? pinned[(i + 1 + pinned.length) % pinned.length]
              : pinned[(i - 1 + pinned.length) % pinned.length];
          if (next) state.setActiveKey(next);
          break;
        }
        default:
          break;
      }
    },
    [cycleThemePref, toggleLeftNav, toggleRightRail, togglePin, setActiveKey, baseUrl, apiKey],
  );

  useEffect(() => {
    const candidate = window.location.protocol.startsWith('http')
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

  const client: ApiClient | null = useMemo(
    () => (baseUrl && apiKey ? { baseUrl, apiKey } : null),
    [baseUrl, apiKey],
  );

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

  const onMessage = useCallback(
    (msg: WsMessage) => {
      // Pull action references off the store at dispatch time. They're stable
      // function identities, so this avoids subscribing App to every store
      // mutation just to keep the callback's dep array honest.
      const s = useStore.getState();
      switch (msg.type) {
        case 'packet':
          s.applyPacket(msg.payload);
          break;
        case 'transportState':
          s.applyTransportState(msg.payload.state, msg.payload.deviceId);
          break;
        case 'scanResults':
          s.applyDevices(msg.payload);
          break;
        case 'error':
          notify.error(msg.payload.message);
          break;
        case 'bridgeStatus':
          s.applyBridge(msg.payload);
          break;
        case 'wsClients':
          s.setWsClients(msg.payload.count);
          break;
        case 'theme':
          setSystemDark(msg.payload.systemDark);
          break;
        case 'menuAction':
          handleMenuAction(msg.payload);
          break;
        case 'channels':
          s.applyChannels(msg.payload);
          break;
        case 'channelPresence':
          s.applyChannelPresence(msg.payload.keys);
          break;
        case 'syncProgress':
          s.applySyncProgress(msg.payload);
          break;
        case 'contacts':
          s.applyContacts(msg.payload);
          break;
        case 'messages':
          s.applyMessages(msg.payload.key, msg.payload.messages);
          break;
        case 'messageState':
          s.applyMessageState(msg.payload.id, msg.payload.state);
          break;
        case 'owner':
          s.applyOwner(msg.payload);
          break;
        case 'appSettings':
          s.applyAppSettings(msg.payload);
          break;
        case 'radioSettings':
          s.applyRadioSettings(msg.payload);
          break;
        case 'mapSettings':
          s.applyMapSettings(msg.payload);
          break;
        case 'mapManifest':
          s.applyMapManifest(msg.payload);
          break;
        case 'uiState':
          s.applyUiState(msg.payload);
          break;
        case 'repeaterStatus':
          s.applyRepeaterStatus(msg.payload);
          break;
        case 'repeaterTelemetry':
          s.applyRepeaterTelemetry(msg.payload);
          break;
        case 'deviceIdentity':
          s.applyDeviceIdentity(msg.payload);
          break;
        case 'autoAddConfig':
          s.applyAutoAddConfig(msg.payload);
          break;
        case 'telemetryPolicy':
          s.applyTelemetryPolicy(msg.payload);
          break;
        case 'gpsConfig':
          s.applyGpsConfig(msg.payload);
          break;
        case 'deviceInfo':
          s.applyDeviceInfo(msg.payload);
          break;
        case 'deviceCapabilities':
          s.applyDeviceCapabilities(msg.payload);
          break;
        case 'pathLearned': {
          s.applyPathLearned(msg.payload);
          if (!msg.payload.previousManual) {
            const contact = s.contacts.find((c) => c.key === msg.payload.contactKey);
            const hops = Math.max(
              1,
              Math.floor(msg.payload.newOutPathHex.length / 2 / msg.payload.newOutPathHashSize),
            );
            notify.success(
              msg.payload.newOutPathHex
                ? `Path learned: ${contact?.name ?? msg.payload.contactKey} · ${hops} hop${hops === 1 ? '' : 's'}`
                : `Path cleared: ${contact?.name ?? msg.payload.contactKey}`,
            );
          }
          break;
        }
      }
    },
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

function PacketLogHost() {
  const packets = useStore((s) => s.packets);
  return <PacketLog packets={packets} />;
}

function StatusBarHost({ port }: { port: number | null }) {
  const transportState = useStore((s) => s.transportState);
  const bridge = useStore((s) => s.bridge);
  const wsClients = useStore((s) => s.wsClients);
  return (
    <StatusBar port={port} wsClients={wsClients} transportState={transportState} bridge={bridge} />
  );
}

function PathLearnedDialogHost({ client }: { client: ApiClient | null }) {
  const event = useStore((s) => s.pendingPathLearn);
  const contact = useStore((s) =>
    event ? (s.contacts.find((c) => c.key === event.contactKey) ?? null) : null,
  );
  const dismiss = useStore((s) => s.dismissPathLearned);
  return <PathLearnedDialog event={event} contact={contact} client={client} onClose={dismiss} />;
}
