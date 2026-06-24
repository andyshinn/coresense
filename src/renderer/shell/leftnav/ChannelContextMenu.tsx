import { CopyIcon, DrawingPinFilledIcon, DrawingPinIcon, MinusIcon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { BellOff } from 'lucide-react';
import type { Channel } from '../../../shared/types';
import { copyToClipboard, menuItem, menuSeparator } from '../../components/ContextMenu';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { type ContextMenuEntry, EntryContextMenu } from './contextMenu';

/** State payload for a positioned channel context menu. */
export interface ChannelMenuState {
  channel: Channel;
  onDevice: boolean;
  x: number;
  y: number;
}

/** Right-click menu for a channel row — pin/mute/copy + add/remove from device + delete. */
export function ChannelContextMenu({
  state,
  client,
  isPinned,
  onTogglePin,
  onClose,
}: {
  state: ChannelMenuState;
  client: ApiClient | null;
  isPinned: boolean;
  onTogglePin: (key: string) => void;
  onClose: () => void;
}) {
  const { channel, onDevice, x, y } = state;
  const transport = useStore((s) => s.transportState);
  const connected = transport === 'connected';

  const items: ContextMenuEntry[] = [
    menuItem(isPinned ? 'Unpin' : 'Pin to top', () => onTogglePin(channel.key), {
      icon: isPinned ? DrawingPinIcon : DrawingPinFilledIcon,
      testid: 'pin-toggle-menu-item',
    }),
    menuItem(
      channel.muted ? 'Unmute' : 'Mute',
      async () => {
        if (!client) return;
        try {
          await api.putChannel(client, { ...channel, muted: !channel.muted });
        } catch (err) {
          notify.error(`Mute toggle failed: ${(err as Error).message}`, err);
        }
      },
      { icon: BellOff, disabled: !client },
    ),
    menuItem('Copy name', () => copyToClipboard(channel.name, () => notify.success('Copied')), {
      icon: CopyIcon,
    }),
    menuSeparator,
    onDevice
      ? menuItem(
          'Remove from device',
          async () => {
            if (!client) return;
            try {
              await api.removeChannelFromDevice(client, channel.key);
              notify.success(`Removed "${channel.name}" from device`);
            } catch (err) {
              notify.error(`Remove failed: ${(err as Error).message}`, err);
            }
          },
          { icon: MinusIcon, disabled: !connected || !client },
        )
      : menuItem(
          'Add to device',
          async () => {
            if (!client) return;
            try {
              const res = await api.pushChannelToDevice(client, channel.key);
              notify.success(`Added "${channel.name}" to device (slot ${res.idx})`);
            } catch (err) {
              notify.error(`Add failed: ${(err as Error).message}`, err);
            }
          },
          { icon: PlusIcon, disabled: !connected || !client },
        ),
    menuSeparator,
    menuItem(
      'Delete from app (clears history)',
      async () => {
        if (!client) return;
        try {
          await api.deleteChannel(client, channel.key);
          notify.success(`Deleted "${channel.name}" from app`);
        } catch (err) {
          notify.error(`Delete failed: ${(err as Error).message}`, err);
        }
      },
      { icon: TrashIcon, danger: true, disabled: !client },
    ),
  ];

  return <EntryContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
