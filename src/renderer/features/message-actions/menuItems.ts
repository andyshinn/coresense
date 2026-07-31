import { Copy, RotateCw, ShieldOff, User } from 'lucide-react';
import type { Message } from '../../../shared/types';
import type { BlockSenderDialogPrefill } from '../../components/BlockSenderDialog';
import { type ContextMenuEntry, copyToClipboard, menuItem, menuSeparator } from '../../components/ContextMenu';

export interface BuildMessageMenuOpts {
  message: Message;
  onResend?: (m: Message) => void;
  onViewContact: (key: string) => void;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  senderName: string | undefined;
}

/** The one item set behind both the right-click menu and the action-bar
 *  overflow menu. Two renderers, one list. */
export function buildMessageMenuItems({
  message,
  onResend,
  onViewContact,
  onBlock,
  senderName,
}: BuildMessageMenuOpts): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [menuItem('Copy text', () => copyToClipboard(message.body), { icon: Copy })];

  const pk = message.fromPublicKeyHex;
  if (pk && pk !== 'unknown' && !pk.startsWith('name:')) {
    items.push(menuItem('View contact', () => onViewContact(`c:${pk}`), { icon: User }));
  }

  if (message.state === 'failed' && onResend) {
    items.push(menuSeparator);
    items.push(menuItem('Re-send', () => onResend(message), { icon: RotateCw }));
  }

  items.push(menuSeparator);
  const originHop = message.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
  const rawPk = message.fromPublicKeyHex;
  const hasRealPubkey = rawPk != null && rawPk !== 'unknown' && !rawPk.startsWith('name:');
  // Origin hop pk would carry an advert-resolved pubkey, but the current
  // path-build pipeline never populates it for channel messages — it's always
  // null. Treat it as the authoritative source if a future change wires it.
  const pubkey = hasRealPubkey ? rawPk : (originHop?.pk ?? undefined);
  // Prefix is the first 4 hex chars of the real pubkey. originHop.shortId
  // is a 2-char name-derived display label (NOT hex), so we don't use it as
  // a pubkey prefix — that would silently create rules like pattern='sr'
  // that match by name lookalike, which is misleading.
  const prefix = hasRealPubkey ? rawPk.slice(0, 4) : (originHop?.pk?.slice(0, 4) ?? undefined);
  items.push(
    menuItem(
      'Block sender…',
      () => {
        onBlock({
          pubkey,
          pubkeyPrefix: prefix,
          name: senderName || undefined,
        });
      },
      { icon: ShieldOff },
    ),
  );

  return items;
}
