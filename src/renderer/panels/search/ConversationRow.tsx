import { Hash } from 'lucide-react';
import type { ConversationHit } from '../../../shared/types';
import { CONTACT_ICON } from '../../lib/conversationIcons';

function shortPk(pk: string): string {
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 6)}…${pk.slice(-4)}`;
}

export function ConversationRow({ hit, onClick }: { hit: ConversationHit; onClick: () => void }) {
  // Channels use the hash glyph; contacts use the shared per-kind icon
  // (chat → MessageCircle, repeater → Radio, room → DoorOpen, sensor → Activity).
  const Icon = hit.kind === 'channel' ? Hash : CONTACT_ICON[hit.contactKind ?? 'chat'];
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-cs-text transition-colors hover:bg-cs-bg-2"
      >
        <Icon size={14} className="text-cs-text-muted" aria-hidden="true" />
        <span className="truncate">{hit.name}</span>
        {hit.contactKind && (
          <span className="rounded border border-cs-border px-1 text-[10px] text-cs-text-dim">
            {hit.contactKind}
          </span>
        )}
        {hit.publicKeyHex && (
          <span className="font-mono text-[10px] text-cs-text-dim">
            {shortPk(hit.publicKeyHex)}
          </span>
        )}
        {hit.messageMatches > 0 && (
          <span className="ml-auto font-mono text-[10px] text-cs-text-dim">
            {hit.messageMatches} match{hit.messageMatches === 1 ? '' : 'es'}
          </span>
        )}
      </button>
    </li>
  );
}
