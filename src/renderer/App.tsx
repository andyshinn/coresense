import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MenuAction, UiState, WsMessage } from '../shared/types';
import { ApiKeyGate } from './components/ApiKeyGate';
import { PacketLog } from './components/PacketLog';
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
  loadThemePref,
  resolveTheme,
  saveThemePref,
  systemPrefersDark,
  type ThemePref,
} from './lib/theme';
import { AppShell } from './shell/AppShell';
import { MainPane } from './shell/MainPane';

const STATUS_POLL_MS = 2_000;
const UI_STATE_DEBOUNCE_MS = 500;
const FALLBACK_BASE_URL = 'http://127.0.0.1:7654';

export function App() {
  const [apiKey, setApiKey] = useState<string | null>(() => loadApiKey());
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const [themePref, setThemePref] = useState<ThemePref>(() => loadThemePref());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());
  const [hydrated, setHydrated] = useState(false);

  const transportState = useStore((s) => s.transportState);
  const bridge = useStore((s) => s.bridge);
  const packets = useStore((s) => s.packets);
  const wsClients = useStore((s) => s.wsClients);
  const ui = useStore((s) => s.ui);

  const {
    hydrate,
    applyPacket,
    applyTransportState,
    applyDevices,
    applyBridge,
    applyMessages,
    applyMessageState,
    applyChannels,
    applyChannelPresence,
    applySyncProgress,
    applyContacts,
    applyOwner,
    applyAppSettings,
    applyRadioSettings,
    applyRepeaterStatus,
    applyRepeaterTelemetry,
    applyPathLearned,
    setBusy,
    setWsClients,
    toggleLeftNav,
    toggleRightRail,
    togglePin,
    setActiveKey,
  } = useStore();

  useEffect(() => {
    applyTheme(resolveTheme(themePref, systemDark));
  }, [themePref, systemDark]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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
    setThemePref((prev) => {
      const next: ThemePref = prev === 'auto' ? 'dark' : prev === 'dark' ? 'light' : 'auto';
      saveThemePref(next);
      return next;
    });
  }, []);

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
      } catch {
        try {
          const caps = await fetchCapabilities(FALLBACK_BASE_URL);
          setBaseUrl(FALLBACK_BASE_URL);
          setPort(caps.httpPort);
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
      switch (msg.type) {
        case 'packet':
          applyPacket(msg.payload);
          break;
        case 'transportState':
          applyTransportState(msg.payload.state, msg.payload.deviceId);
          break;
        case 'scanResults':
          applyDevices(msg.payload);
          break;
        case 'error':
          notify.error(msg.payload.message);
          break;
        case 'bridgeStatus':
          applyBridge(msg.payload);
          break;
        case 'theme':
          setSystemDark(msg.payload.systemDark);
          break;
        case 'menuAction':
          handleMenuAction(msg.payload);
          break;
        case 'channels':
          applyChannels(msg.payload);
          break;
        case 'channelPresence':
          applyChannelPresence(msg.payload.keys);
          break;
        case 'syncProgress':
          applySyncProgress(msg.payload);
          break;
        case 'contacts':
          applyContacts(msg.payload);
          break;
        case 'messages':
          applyMessages(msg.payload.key, msg.payload.messages);
          break;
        case 'messageState':
          applyMessageState(msg.payload.id, msg.payload.state);
          break;
        case 'owner':
          applyOwner(msg.payload);
          break;
        case 'appSettings':
          applyAppSettings(msg.payload);
          break;
        case 'radioSettings':
          applyRadioSettings(msg.payload);
          break;
        case 'repeaterStatus':
          applyRepeaterStatus(msg.payload);
          break;
        case 'repeaterTelemetry':
          applyRepeaterTelemetry(msg.payload);
          break;
        case 'pathLearned': {
          applyPathLearned(msg.payload);
          if (!msg.payload.previousManual) {
            // Silent absorbed — surface a toast so the user can see what changed.
            const contact = useStore
              .getState()
              .contacts.find((c) => c.key === msg.payload.contactKey);
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
    [
      applyPacket,
      applyTransportState,
      applyDevices,
      applyBridge,
      applyMessages,
      applyMessageState,
      applyChannels,
      applyChannelPresence,
      applySyncProgress,
      applyContacts,
      applyOwner,
      applyAppSettings,
      applyRadioSettings,
      applyRepeaterStatus,
      applyRepeaterTelemetry,
      applyPathLearned,
      handleMenuAction,
    ],
  );

  useWebSocket({ url: wsUrl, onMessage });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await api.status(client);
        if (!cancelled) {
          setWsClients(s.wsClients);
          applyBridge(s.bridge);
        }
      } catch {
        // ignore transient
      }
    };
    void tick();
    const id = window.setInterval(tick, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [client, applyBridge, setWsClients]);

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
          <MainPane
            client={client}
            onScan={handleScan}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            renderPacketLog={() => <PacketLog packets={packets} />}
          />
        </div>

        <StatusBar
          port={port}
          wsClients={wsClients}
          transportState={transportState}
          bridge={bridge}
        />
      </div>
    </AppShell>
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
