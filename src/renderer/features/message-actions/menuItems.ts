import { Copy, KeyRound, Radio, RotateCw, ShieldOff, Trash2, User, Waypoints } from 'lucide-react';
import type { Message } from '../../../shared/types';
import type { BlockSenderDialogPrefill } from '../../components/BlockSenderDialog';
import { type ContextMenuEntry, copyToClipboard, menuItem, menuSeparator } from '../../components/ContextMenu';
import { notify } from '../../lib/notify';
import { formatAllPathsHeard, formatFirstPathHeard } from './paths';

export interface BuildMessageMenuOpts {
  message: Message;
  isSelf: boolean;
  senderName: string | undefined;
  onViewContact: (key: string) => void;
  onBlock: (prefill: BlockSenderDialogPrefill) => void;
  onDelete: (message: Message) => void;
  onResend?: (m: Message) => void;
}

/** Push `entry` only when the list doesn't already end with a separator, so a
 *  group whose items were all filtered out doesn't leave a double rule. */
function pushSeparator(items: ContextMenuEntry[]): void {
  if (items.length > 0 && items[items.length - 1].kind !== 'separator') items.push(menuSeparator);
}

/** The one item set behind both the right-click menu and the action-bar
 *  overflow menu. Two renderers, one list. */
export function buildMessageMenuItems({
  message,
  isSelf,
  senderName,
  onViewContact,
  onBlock,
  onDelete,
  onResend,
}: BuildMessageMenuOpts): ContextMenuEntry[] {
  const copy = (text: string, label: string) => copyToClipboard(text, () => notify.success(label));

  const items: ContextMenuEntry[] = [menuItem('Copy text', () => copy(message.body, 'Copied message text'), { icon: Copy })];

  const rawPk = message.fromPublicKeyHex;
  const hasRealPubkey = rawPk != null && rawPk !== 'unknown' && !rawPk.startsWith('name:');
  const firstPath = formatFirstPathHeard(message);
  const allPaths = formatAllPathsHeard(message);

  if (hasRealPubkey || firstPath || allPaths) pushSeparator(items);
  if (hasRealPubkey) {
    items.push(menuItem('View contact', () => onViewContact(`c:${rawPk}`), { icon: User }));
    items.push(menuItem('Copy public key', () => copy(rawPk, 'Copied public key'), { icon: KeyRound }));
  }
  if (firstPath) {
    items.push(menuItem('Copy first path heard', () => copy(firstPath, 'Copied first path'), { icon: Waypoints }));
  }
  if (allPaths) {
    items.push(menuItem('Copy all paths heard', () => copy(allPaths, 'Copied all paths'), { icon: Radio }));
  }

  const canResend = message.state === 'failed' && onResend != null;
  if (canResend || !isSelf) pushSeparator(items);
  if (canResend && onResend) {
    items.push(menuItem('Re-send', () => onResend(message), { icon: RotateCw }));
  }
  if (!isSelf) {
    // Origin hop pk would carry an advert-resolved pubkey, but the current
    // path-build pipeline never populates it for channel messages — it's always
    // null. Treat it as the authoritative source if a future change wires it.
    const originHop = message.meta?.paths?.[0]?.hops.find((h) => h.kind === 'origin');
    const pubkey = hasRealPubkey ? rawPk : (originHop?.pk ?? undefined);
    // Prefix is the first 4 hex chars of the real pubkey. originHop.shortId
    // is a 2-char name-derived display label (NOT hex), so we don't use it as
    // a pubkey prefix — that would silently create rules like pattern='sr'
    // that match by name lookalike, which is misleading.
    const prefix = hasRealPubkey ? rawPk.slice(0, 4) : (originHop?.pk?.slice(0, 4) ?? undefined);
    items.push(
      menuItem('Block sender…', () => onBlock({ pubkey, pubkeyPrefix: prefix, name: senderName || undefined }), {
        icon: ShieldOff,
      }),
    );
  }

  pushSeparator(items);
  items.push(
    menuItem('Delete message', () => onDelete(message), {
      icon: Trash2,
      danger: true,
      testid: 'delete-message-menu-item',
    }),
  );

  return items;
}
