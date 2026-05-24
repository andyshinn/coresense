import { Hash, User } from 'lucide-react';
import type { MessageHit } from '../../../shared/types';
import { RelativeTime } from '../../components/RelativeTime';

export function MessageRow({
  hit,
  channelName,
  senderName,
  onClick,
}: {
  hit: MessageHit;
  channelName: string | undefined;
  senderName: string;
  onClick: () => void;
}) {
  const isChannel = hit.key.startsWith('ch:');
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full flex-col gap-1 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-cs-border hover:bg-cs-bg-2"
      >
        <div className="flex items-center gap-2 font-mono text-[10px] text-cs-text-dim">
          {isChannel ? (
            <Hash size={11} aria-hidden="true" />
          ) : (
            <User size={11} aria-hidden="true" />
          )}
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
    </li>
  );
}
