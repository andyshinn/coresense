import {
  ArrowUpCircle,
  CheckCheck,
  Clipboard,
  Eraser,
  FileJson,
  Hash,
  PanelLeft,
  PanelRight,
  Pin,
  PowerOff,
  Radio,
  Signal,
  Sun,
} from 'lucide-react';
import type { Contact, Owner, RawPacket, TransportState } from '../../../../shared/types';
import { type ApiClient, api } from '../../../lib/api';
import type { LastDevice } from '../../../lib/lastDevice';
import { notify } from '../../../lib/notify';
import type { PaletteItem } from '../types';

export interface BuildActionsArgs {
  client: ApiClient | null;
  close: () => void;
  cycleThemePref: () => void;
  toggleLeftNav: () => void;
  toggleRightRail: () => void;
  togglePin: (key: string) => void;
  setActiveKey: (key: string) => void;
  setAddChannelOpen: (open: boolean) => void;
  markAllRead: (key: string) => void;
  markAllReadGlobal: () => void;
  clearPackets: () => void;
  lastDevice: LastDevice | null;
  transportState: TransportState;
  owner: Owner | null;
  packets: RawPacket[];
  activeKey: string;
  activeContact: Contact | undefined;
}

export function buildActionItems({
  client,
  close,
  cycleThemePref,
  toggleLeftNav,
  toggleRightRail,
  togglePin,
  setActiveKey,
  setAddChannelOpen,
  markAllRead,
  markAllReadGlobal,
  clearPackets,
  lastDevice,
  transportState,
  owner,
  packets,
  activeKey,
  activeContact,
}: BuildActionsArgs): PaletteItem[] {
  const list: PaletteItem[] = [];

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
  list.push({
    id: 'action:addChannel',
    label: 'Add channel…',
    hint: transportState === 'connected' ? 'Create or join' : 'Connect a radio first',
    group: 'action',
    groupLabel: 'Actions',
    icon: Hash,
    keywords: 'add new create join channel hashtag private public',
    run: () => {
      if (transportState !== 'connected') return;
      setAddChannelOpen(true);
      close();
    },
  });

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

  list.push({
    id: 'action:checkForUpdates',
    label: 'Check for updates',
    hint: 'App',
    group: 'action',
    groupLabel: 'Actions',
    icon: ArrowUpCircle,
    keywords: 'update upgrade version check',
    run: () => {
      if (!client) return;
      void api.checkForUpdates(client).then(
        (r) => {
          if (r.updateState?.status === 'available') notify.success(`Update available: ${r.updateState.latestVersion}`);
          else if (r.updateState?.status === 'up-to-date') notify.info('You are up to date');
        },
        (err) => notify.error(`Update check failed: ${(err as Error).message}`, err),
      );
      close();
    },
  });

  return list;
}
