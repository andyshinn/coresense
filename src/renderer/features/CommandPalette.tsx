import type { LucideIcon } from 'lucide-react';
import {
  CheckCheck,
  Clipboard,
  Cog,
  Eraser,
  FileJson,
  Hash,
  Inbox,
  MapIcon,
  MessageCircle,
  PanelLeft,
  PanelRight,
  Pin,
  PowerOff,
  Radio,
  ScrollText,
  Signal,
  Sun,
  Users,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/command';
import { type ApiClient, api } from '../lib/api';
import { loadLastDevice } from '../lib/lastDevice';
import { notify } from '../lib/notify';
import { useStore } from '../lib/store';

interface Props {
  client: ApiClient | null;
  cycleThemePref: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: 'recent' | 'pinned' | 'goto' | 'action';
  groupLabel: string;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

export function CommandPalette({ client, cycleThemePref }: Props) {
  const open = useStore((s) => s.paletteOpen);
  const close = useStore((s) => s.closePalette);

  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const recentKeys = useStore((s) => s.ui.recentKeys);
  const pinnedKeys = useStore((s) => s.ui.pinned);
  const activeKey = useStore((s) => s.ui.activeKey);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const togglePin = useStore((s) => s.togglePin);
  const toggleLeftNav = useStore((s) => s.toggleLeftNav);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const transportState = useStore((s) => s.transportState);
  const owner = useStore((s) => s.owner);
  const packets = useStore((s) => s.packets);
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const markAllRead = useStore((s) => s.markAllRead);
  const markAllReadGlobal = useStore((s) => s.markAllReadGlobal);
  const clearPackets = useStore((s) => s.clearPackets);

  const lastDevice = useMemo(() => (open ? loadLastDevice() : null), [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    for (const key of recentKeys) {
      if (key === activeKey) continue;
      const item = resolveKeyItem(key, channels, contacts);
      if (!item) continue;
      list.push({
        ...item,
        group: 'recent',
        groupLabel: 'Recent',
        run: () => {
          setActiveKey(key);
          close();
        },
      });
    }

    for (const key of pinnedKeys) {
      if (key === activeKey) continue;
      const item = resolveKeyItem(key, channels, contacts);
      if (!item) continue;
      list.push({
        ...item,
        id: `pinned:${key}`,
        group: 'pinned',
        groupLabel: 'Pinned',
        run: () => {
          setActiveKey(key);
          close();
        },
      });
    }

    const canReconnect = lastDevice && (transportState === 'idle' || transportState === 'error');
    if (canReconnect && lastDevice) {
      list.push({
        id: 'action:reconnect',
        label: `Reconnect to ${lastDevice.name ?? lastDevice.id.slice(0, 12)}`,
        hint: 'BLE',
        group: 'action',
        groupLabel: 'Actions',
        icon: Radio,
        keywords: `reconnect ${lastDevice.id}`,
        run: () => {
          if (!client) return;
          void api.connect(client, lastDevice.id).catch((err) => {
            notify.error(`Reconnect failed: ${(err as Error).message}`, err);
          });
          close();
        },
      });
    }

    list.push({
      id: 'action:sendAdvertFlood',
      label: 'Send advert (flood)',
      hint: 'Discoverable to the whole mesh',
      group: 'action',
      groupLabel: 'Actions',
      icon: Radio,
      keywords: 'advert flood self',
      run: () => {
        if (!client) return;
        void api.sendAdvert(client, true).then(
          () => notify.success('Flood advert sent'),
          (err) => notify.error(`Advert failed: ${(err as Error).message}`, err),
        );
        close();
      },
    });
    list.push({
      id: 'action:sendAdvertZeroHop',
      label: 'Send advert (zero-hop)',
      hint: 'Direct neighbors only',
      group: 'action',
      groupLabel: 'Actions',
      icon: Radio,
      keywords: 'advert zero-hop direct',
      run: () => {
        if (!client) return;
        void api.sendAdvert(client, false).then(
          () => notify.success('Zero-hop advert sent'),
          (err) => notify.error(`Advert failed: ${(err as Error).message}`, err),
        );
        close();
      },
    });

    const activeContact = contacts.find((c) => c.key === activeKey);
    if (activeContact?.kind === 'repeater') {
      list.push({
        id: 'action:repeaterStatus',
        label: 'Request repeater status',
        hint: activeContact.name,
        group: 'action',
        groupLabel: 'Actions',
        icon: Radio,
        keywords: 'repeater status',
        run: () => {
          if (!client) return;
          void api.repeaterStatus(client, activeContact.key).then(
            () => notify.success('Status requested'),
            (err) => notify.error(`Status request failed: ${(err as Error).message}`, err),
          );
          close();
        },
      });
      list.push({
        id: 'action:repeaterTelemetry',
        label: 'Request repeater telemetry',
        hint: activeContact.name,
        group: 'action',
        groupLabel: 'Actions',
        icon: Radio,
        keywords: 'repeater telemetry',
        run: () => {
          if (!client) return;
          void api.repeaterTelemetry(client, activeContact.key).then(
            () => notify.success('Telemetry requested'),
            (err) => notify.error(`Telemetry request failed: ${(err as Error).message}`, err),
          );
          close();
        },
      });
    }

    list.push({
      id: 'action:scanRadios',
      label: 'Scan for radios',
      hint: 'BLE',
      group: 'action',
      groupLabel: 'Actions',
      icon: Radio,
      keywords: 'scan ble discover',
      run: () => {
        if (!client) return;
        void api.scan(client).catch((err) => {
          notify.error(`Scan failed: ${(err as Error).message}`, err);
        });
        setActiveKey('tool:bleconnect');
        close();
      },
    });

    if (owner) {
      list.push({
        id: 'action:copyMyPubkey',
        label: 'Copy my public key',
        hint: owner.publicKeyShort,
        group: 'action',
        groupLabel: 'Actions',
        icon: Clipboard,
        keywords: 'copy pubkey identity',
        run: () => {
          void navigator.clipboard.writeText(owner.publicKeyHex).then(
            () => notify.success('Public key copied'),
            (err) => notify.error(`Copy failed: ${(err as Error).message}`, err),
          );
          close();
        },
      });
    }
    if (activeContact) {
      list.push({
        id: 'action:copyContactPubkey',
        label: `Copy ${activeContact.name}'s public key`,
        hint: `${activeContact.publicKeyHex.slice(0, 12)}…`,
        group: 'action',
        groupLabel: 'Actions',
        icon: Clipboard,
        keywords: 'copy pubkey contact',
        run: () => {
          void navigator.clipboard.writeText(activeContact.publicKeyHex).then(
            () => notify.success('Public key copied'),
            (err) => notify.error(`Copy failed: ${(err as Error).message}`, err),
          );
          close();
        },
      });
    }

    if (activeKey.startsWith('ch:') || activeKey.startsWith('c:')) {
      list.push({
        id: 'action:markAllReadCurrent',
        label: 'Mark all read (current)',
        hint: activeKey,
        group: 'action',
        groupLabel: 'Actions',
        icon: CheckCheck,
        keywords: 'unread mark read',
        run: () => {
          markAllRead(activeKey);
          close();
        },
      });
    }
    list.push({
      id: 'action:markAllReadGlobal',
      label: 'Mark all read (everywhere)',
      group: 'action',
      groupLabel: 'Actions',
      icon: CheckCheck,
      keywords: 'unread mark read all',
      run: () => {
        markAllReadGlobal();
        close();
      },
    });

    list.push({
      id: 'action:lastRxSignal',
      label: 'Show last RX signal',
      hint: 'RSSI / SNR',
      group: 'action',
      groupLabel: 'Actions',
      icon: Signal,
      keywords: 'rssi snr signal diagnostics',
      run: () => {
        const last = [...packets].reverse().find((p) => p.rssi != null || p.snr != null);
        if (!last) {
          notify.info('No packets received yet');
        } else {
          const parts: string[] = [];
          if (last.rssi != null) parts.push(`RSSI ${last.rssi} dBm`);
          if (last.snr != null) parts.push(`SNR ${last.snr.toFixed(1)} dB`);
          notify.info(parts.join(' · '));
        }
        close();
      },
    });
    list.push({
      id: 'action:clearPacketLog',
      label: 'Clear packet log',
      group: 'action',
      groupLabel: 'Actions',
      icon: Eraser,
      keywords: 'clear packet log',
      run: () => {
        clearPackets();
        notify.success('Packet log cleared');
        close();
      },
    });
    list.push({
      id: 'action:exportPacketLog',
      label: 'Export packet log (copy JSON)',
      hint: `${packets.length} packets`,
      group: 'action',
      groupLabel: 'Actions',
      icon: FileJson,
      keywords: 'export packet log json',
      run: () => {
        void navigator.clipboard.writeText(JSON.stringify(packets, null, 2)).then(
          () => notify.success(`Copied ${packets.length} packets`),
          (err) => notify.error(`Copy failed: ${(err as Error).message}`, err),
        );
        close();
      },
    });

    list.push({
      id: 'action:cycleTheme',
      label: 'Cycle theme',
      hint: 'auto → dark → light',
      group: 'action',
      groupLabel: 'Actions',
      icon: Sun,
      run: () => {
        cycleThemePref();
        close();
      },
    });
    list.push({
      id: 'action:toggleLeftNav',
      label: 'Toggle left nav',
      group: 'action',
      groupLabel: 'Actions',
      icon: PanelLeft,
      run: () => {
        toggleLeftNav();
        close();
      },
    });
    list.push({
      id: 'action:toggleRightRail',
      label: 'Toggle right rail',
      group: 'action',
      groupLabel: 'Actions',
      icon: PanelRight,
      run: () => {
        toggleRightRail();
        close();
      },
    });
    if (activeKey.startsWith('ch:') || activeKey.startsWith('c:')) {
      list.push({
        id: 'action:pinToggle',
        label: 'Pin / unpin current',
        hint: activeKey,
        group: 'action',
        groupLabel: 'Actions',
        icon: Pin,
        run: () => {
          togglePin(activeKey);
          close();
        },
      });
    }
    list.push({
      id: 'action:disconnect',
      label: 'Disconnect radio',
      group: 'action',
      groupLabel: 'Actions',
      icon: PowerOff,
      run: () => {
        if (!client) return;
        void api.disconnect(client).catch((err) => {
          notify.error(`Disconnect failed: ${(err as Error).message}`, err);
        });
        close();
      },
    });

    let unreadKey: string | null = null;
    let unreadCount = 0;
    const allConvKeys = [...channels.map((c) => c.key), ...contacts.map((c) => c.key)];
    for (const key of allConvKeys) {
      const msgs = messagesByKey[key];
      if (!msgs || msgs.length === 0) continue;
      const lastRead = lastReadByKey[key] ?? 0;
      const unread = msgs.filter((m) => m.ts > lastRead).length;
      if (unread > 0) {
        unreadCount += unread;
        if (!unreadKey && key !== activeKey) unreadKey = key;
      }
    }
    if (unreadKey && unreadCount > 0) {
      const target = unreadKey;
      list.push({
        id: 'goto:unread',
        label: `Jump to unread (${unreadCount})`,
        hint: target,
        group: 'goto',
        groupLabel: 'Go to',
        icon: Inbox,
        keywords: 'unread jump inbox',
        run: () => {
          setActiveKey(target);
          close();
        },
      });
    }

    for (const ch of channels) {
      if (ch.key === activeKey) continue;
      list.push({
        id: `goto:${ch.key}`,
        label: ch.name,
        hint: ch.key,
        group: 'goto',
        groupLabel: 'Go to',
        icon: Hash,
        keywords: ch.key,
        run: () => {
          setActiveKey(ch.key);
          close();
        },
      });
    }
    for (const c of contacts) {
      if (c.key === activeKey) continue;
      list.push({
        id: `goto:${c.key}`,
        label: c.name,
        hint:
          c.kind === 'repeater'
            ? 'Repeater'
            : c.kind === 'room'
              ? 'Room'
              : c.kind === 'sensor'
                ? 'Sensor'
                : 'Direct message',
        group: 'goto',
        groupLabel: 'Go to',
        icon: c.kind === 'repeater' ? Radio : MessageCircle,
        keywords: c.publicKeyHex,
        run: () => {
          setActiveKey(c.key);
          close();
        },
      });
    }
    for (const tool of TOOL_ITEMS) {
      if (tool.key === activeKey) continue;
      list.push({
        id: `goto:${tool.key}`,
        label: tool.label,
        hint: tool.hint,
        group: 'goto',
        groupLabel: 'Go to',
        icon: tool.icon,
        run: () => {
          setActiveKey(tool.key);
          close();
        },
      });
    }

    return list;
  }, [
    channels,
    contacts,
    recentKeys,
    pinnedKeys,
    activeKey,
    client,
    setActiveKey,
    close,
    cycleThemePref,
    toggleLeftNav,
    toggleRightRail,
    togglePin,
    lastDevice,
    transportState,
    owner,
    packets,
    messagesByKey,
    lastReadByKey,
    markAllRead,
    markAllReadGlobal,
    clearPackets,
  ]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, PaletteItem[]>();
    for (const item of items) {
      const bucket = groups.get(item.groupLabel);
      if (bucket) bucket.push(item);
      else groups.set(item.groupLabel, [item]);
    }
    return [...groups.entries()].map(([groupLabel, groupItems]) => ({
      groupLabel,
      items: groupItems,
    }));
  }, [items]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Command palette"
      description="Search channels, contacts, tools, and actions"
      showCloseButton={false}
      className="border-cs-border bg-cs-bg sm:max-w-xl"
    >
      <CommandInput placeholder="Type to search channels, contacts, tools, actions…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No matches. Try: advert, scan, unread, theme…</CommandEmpty>
        {groupedItems.map(({ groupLabel, items: groupItems }) => (
          <CommandGroup key={groupLabel} heading={groupLabel}>
            {groupItems.map((it) => {
              const Icon = it.icon;
              return (
                <CommandItem
                  key={it.id}
                  value={`${it.id} ${it.label} ${it.hint ?? ''} ${it.keywords ?? ''}`}
                  onSelect={() => it.run()}
                >
                  <Icon aria-hidden="true" />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && (
                    <span className="truncate text-[10px] text-cs-text-dim">{it.hint}</span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
      <footer className="flex shrink-0 items-center gap-3 border-t border-cs-border bg-cs-bg-2 px-3 py-1.5 text-[10px] text-cs-text-dim">
        <Kbd>↑↓</Kbd> navigate
        <Kbd>↵</Kbd> run
        <Kbd>esc</Kbd> close
      </footer>
    </CommandDialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-cs-border bg-cs-bg-3 px-1 py-px font-mono text-[10px] text-cs-text-muted">
      {children}
    </kbd>
  );
}

interface ToolItem {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const TOOL_ITEMS: ToolItem[] = [
  {
    key: 'tool:settings:app',
    label: 'App Settings',
    hint: 'Theme, notifications, proxy',
    icon: Cog,
  },
  {
    key: 'tool:settings:radio',
    label: 'Radio Settings',
    hint: 'Frequency, SF, TX power',
    icon: Radio,
  },
  {
    key: 'tool:settings:identity',
    label: 'Identity',
    hint: 'Owner name + public key',
    icon: Users,
  },
  { key: 'tool:packetlog', label: 'Packet Log', hint: 'Live RX/TX', icon: ScrollText },
  { key: 'tool:map', label: 'Map', hint: 'Contact locations', icon: MapIcon },
  { key: 'tool:contacts', label: 'Contact Management', hint: 'Add / edit contacts', icon: Users },
  {
    key: 'tool:bleconnect',
    label: 'BLE Connect',
    hint: 'Scan + connect a radio',
    icon: Radio,
  },
];

function resolveKeyItem(
  key: string,
  channels: Array<{ key: string; name: string }>,
  contacts: Array<{ key: string; name: string; kind: string }>,
): Pick<PaletteItem, 'id' | 'label' | 'hint' | 'icon' | 'keywords'> | null {
  if (key.startsWith('ch:')) {
    const ch = channels.find((c) => c.key === key);
    if (!ch) return null;
    return { id: `recent:${key}`, label: ch.name, hint: 'channel', icon: Hash, keywords: key };
  }
  if (key.startsWith('c:')) {
    const c = contacts.find((x) => x.key === key);
    if (!c) return null;
    return {
      id: `recent:${key}`,
      label: c.name,
      hint: c.kind,
      icon: c.kind === 'repeater' ? Radio : MessageCircle,
      keywords: key,
    };
  }
  const tool = TOOL_ITEMS.find((t) => t.key === key);
  if (tool) {
    return { id: `recent:${key}`, label: tool.label, hint: tool.hint, icon: tool.icon };
  }
  return null;
}
