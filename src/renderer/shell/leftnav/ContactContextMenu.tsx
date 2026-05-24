import { BellOff, Copy, Megaphone, PinIcon, PinOff, Trash2 } from 'lucide-react';
import type { Contact } from '../../../shared/types';
import { copyToClipboard, menuItem, menuSeparator } from '../../components/ContextMenu';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { type ContextMenuEntry, EntryContextMenu } from './contextMenu';

/** State payload for a positioned contact context menu. */
export interface ContactMenuState {
  contact: Contact;
  x: number;
  y: number;
}

/** Right-click menu for a contact row — open/pin/mute + copy key + self-advert + remove. */
export function ContactContextMenu({
  state,
  client,
  isPinned,
  onTogglePin,
  onClose,
}: {
  state: ContactMenuState;
  client: ApiClient | null;
  isPinned: boolean;
  onTogglePin: (key: string) => void;
  onClose: () => void;
}) {
  const { contact, x, y } = state;
  const transport = useStore((s) => s.transportState);
  const connected = transport === 'connected';
  const setActiveKey = useStore((s) => s.setActiveKey);

  const items: ContextMenuEntry[] = [
    menuItem('Open', () => setActiveKey(contact.key)),
    menuItem(isPinned ? 'Unpin' : 'Pin to top', () => onTogglePin(contact.key), {
      icon: isPinned ? PinOff : PinIcon,
    }),
    menuItem(
      contact.muted ? 'Unmute' : 'Mute',
      async () => {
        if (!client) return;
        try {
          await api.putContact(client, { ...contact, muted: !contact.muted });
        } catch (err) {
          notify.error(`Mute toggle failed: ${(err as Error).message}`, err);
        }
      },
      { icon: BellOff, disabled: !client },
    ),
    menuSeparator,
    menuItem(
      'Copy public key',
      () => copyToClipboard(contact.publicKeyHex, () => notify.success('Public key copied')),
      { icon: Copy },
    ),
    menuItem(
      'Send self-advert',
      async () => {
        if (!client) return;
        try {
          await api.sendAdvert(client);
          notify.success('Self-advert sent');
        } catch (err) {
          notify.error(`Advert failed: ${(err as Error).message}`, err);
        }
      },
      { icon: Megaphone, disabled: !connected || !client },
    ),
    menuSeparator,
    menuItem(
      'Remove (clears history)',
      async () => {
        if (!client) return;
        try {
          await api.deleteContact(client, contact.key);
          notify.success(`Removed "${contact.name}"`);
        } catch (err) {
          notify.error(`Remove failed: ${(err as Error).message}`, err);
        }
      },
      { icon: Trash2, danger: true, disabled: !client },
    ),
  ];

  return <EntryContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
