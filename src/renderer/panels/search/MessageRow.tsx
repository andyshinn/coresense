import { Hash, Trash2, User } from 'lucide-react';
import type { MessageHit } from '../../../shared/types';
import { RelativeTime } from '../../components/RelativeTime';
import { DeleteConfirmPopover } from '../../features/message-actions/DeleteConfirmPopover';
import type { ApiClient } from '../../lib/api';
import { useStore } from '../../lib/store';

export function SearchMessageRow({
  hit,
  channelName,
  senderName,
  onClick,
  client,
  onDeleted,
}: {
  hit: MessageHit;
  channelName: string | undefined;
  senderName: string;
  onClick: () => void;
  client: ApiClient | null;
  onDeleted: (id: string) => void;
}) {
  const setPendingDeleteMessageId = useStore((s) => s.setPendingDeleteMessageId);
  const isChannel = hit.key.startsWith('ch:');
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-col gap-1 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-cs-border hover:bg-cs-bg-2"
      >
        <div className="flex items-center gap-2 font-mono text-[10px] text-cs-text-dim">
          {isChannel ? <Hash size={11} aria-hidden="true" /> : <User size={11} aria-hidden="true" />}
          <span>{isChannel ? (channelName ?? hit.key) : (senderName ?? hit.key)}</span>
          <span>·</span>
          <RelativeTime ts={hit.ts} />
          {isChannel && (
            <>
              <span>·</span>
              <span>{senderName}</span>
            </>
          )}
        </div>
        <div
          className="text-sm text-cs-text [&_mark]:rounded-sm [&_mark]:bg-cs-accent-soft/60 [&_mark]:px-0.5 [&_mark]:text-cs-text"
          // FTS5 snippet returns body chars HTML-escaped server-side; the only
          // raw tags it can contain are the <mark>…</mark> wrappers we asked
          // for. Safe to dangerouslySetInnerHTML.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: snippet is HTML-escaped server-side except for the mark tags
          dangerouslySetInnerHTML={{ __html: hit.snippet }}
        />
      </button>
      <button
        type="button"
        aria-label="Delete message"
        data-testid="search-delete-message"
        onClick={(e) => {
          e.stopPropagation();
          setPendingDeleteMessageId(hit.id);
        }}
        // Revealed by opacity rather than `hidden`, matching PeopleRow: a
        // display:none button is not tabbable, so the only way to delete a hit
        // was with a mouse. pointer-events-none keeps the invisible button from
        // swallowing clicks meant for the row beneath it.
        className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-cs-text-muted opacity-0 transition-opacity hover:bg-cs-danger/10 hover:text-cs-danger group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
      <DeleteConfirmPopover
        messageId={hit.id}
        conversationKey={hit.key}
        preview={hit.body}
        client={client}
        onDeleted={() => onDeleted(hit.id)}
      />
    </li>
  );
}
