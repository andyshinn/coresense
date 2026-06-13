import { Loader2 } from 'lucide-react';
import type { ConversationHit, MessageHit } from '../../../shared/types';
import { EmptyState, Section } from './atoms';
import { ConversationRow } from './ConversationRow';
import { shortPk } from './format';
import { MessageRow } from './MessageRow';
import { partitionConversations } from './partition';

interface Props {
  hasQuery: boolean;
  loading: boolean;
  error: string | null;
  empty: boolean;
  searchQuery: string;
  hasResults: boolean;
  conversations: ConversationHit[];
  messages: MessageHit[];
  totalMessages: number;
  channelByKey: Map<string, string>;
  contactByPk: Map<string, string>;
  ownerName: string;
  canLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onConversationClick: (hit: ConversationHit) => void;
  onMessageClick: (hit: MessageHit) => void;
}

export function ResultsList({
  hasQuery,
  error,
  empty,
  searchQuery,
  hasResults,
  conversations,
  messages,
  totalMessages,
  channelByKey,
  contactByPk,
  ownerName,
  canLoadMore,
  loadingMore,
  onLoadMore,
  onConversationClick,
  onMessageClick,
}: Props) {
  // Drop hits annotated by main as matching an active block rule. The
  // totalMessages count still reflects the server's full match total — the
  // header reads "(visible of total)" and "Load more" continues to fetch
  // against the unfiltered server total.
  const visibleMessages = messages.filter((m) => m.blocked !== true);
  const { channels, contacts } = partitionConversations(conversations);
  return (
    <div className="flex-1 overflow-y-auto">
      {!hasQuery && (
        <EmptyState
          title="Type to search"
          body="Search messages, channel names, contacts, and public keys. Cmd/Ctrl+F focuses the field."
        />
      )}
      {hasQuery && error && <EmptyState title="Search failed" body={error} />}
      {empty && <EmptyState title="No results" body={`No matches for "${searchQuery}".`} />}
      {hasResults && (
        <div className="space-y-4 p-4">
          {channels.length > 0 && (
            <Section title={`Channels (${channels.length})`}>
              <ul className="divide-y divide-cs-border">
                {channels.map((hit) => (
                  <ConversationRow key={hit.key} hit={hit} onClick={() => onConversationClick(hit)} />
                ))}
              </ul>
            </Section>
          )}
          {contacts.length > 0 && (
            <Section title={`Contacts (${contacts.length})`}>
              <ul className="divide-y divide-cs-border">
                {contacts.map((hit) => (
                  <ConversationRow key={hit.key} hit={hit} onClick={() => onConversationClick(hit)} />
                ))}
              </ul>
            </Section>
          )}
          {visibleMessages.length > 0 && (
            <Section title={`Messages (${visibleMessages.length} of ${totalMessages})`}>
              <ul className="space-y-1">
                {visibleMessages.map((hit) => (
                  <MessageRow
                    key={`${hit.key}:${hit.id}`}
                    hit={hit}
                    channelName={channelByKey.get(hit.key)}
                    senderName={
                      hit.fromPublicKeyHex
                        ? (contactByPk.get(hit.fromPublicKeyHex) ??
                          (hit.fromPublicKeyHex.startsWith('name:')
                            ? hit.fromPublicKeyHex.slice(5)
                            : hit.fromPublicKeyHex === 'unknown'
                              ? 'unknown'
                              : shortPk(hit.fromPublicKeyHex)))
                        : ownerName
                    }
                    onClick={() => onMessageClick(hit)}
                  />
                ))}
              </ul>
              {canLoadMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-cs-border bg-cs-bg-3 px-3 py-1.5 text-xs text-cs-text-muted transition-colors hover:bg-cs-bg-2 hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
                  {loadingMore ? 'Loading…' : `Load more (${totalMessages - messages.length} more)`}
                </button>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
