import type { LucideIcon } from 'lucide-react';
import { DoorOpen, Hash, Loader2, Radio, Search, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConversationHit,
  MessageHit,
  SearchResults as SearchResultsPayload,
  SearchSort,
} from '../../shared/types';
import { RelativeTime } from '../components/RelativeTime';
import { type ApiClient, api } from '../lib/api';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';

interface Props {
  client: ApiClient | null;
}

const DEBOUNCE_MS = 150;
const PAGE_LIMIT = 100;
// One full day minus a millisecond — added to the parsed midnight of a "To"
// date so the filter is inclusive of the picked day.
const END_OF_DAY_MS = 86_399_999;

// Mirror lucide icons used elsewhere in the app so result chips line up with
// the LeftNav iconography. Repeater/sensor share Radio; room uses DoorOpen.
const CONTACT_KIND_ICON: Record<string, LucideIcon> = {
  chat: User,
  repeater: Radio,
  sensor: Radio,
  room: DoorOpen,
};

function shortPk(pk: string): string {
  if (pk.length <= 12) return pk;
  return `${pk.slice(0, 6)}…${pk.slice(-4)}`;
}

export function SearchResults({ client }: Props) {
  const searchQuery = useStore((s) => s.searchQuery);
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const filters = useStore((s) => s.searchFilters);
  const setFilters = useStore((s) => s.setSearchFilters);
  const sort = useStore((s) => s.searchSort);
  const setSort = useStore((s) => s.setSearchSort);
  const clearSearch = useStore((s) => s.clearSearch);
  const activeKey = useStore((s) => s.ui.activeKey);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const setPendingJump = useStore((s) => s.setPendingJump);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const owner = useStore((s) => s.owner);
  const appSettings = useStore((s) => s.appSettings);
  const messagesByKey = useStore((s) => s.messagesByKey);

  // Page-accumulated results — replaced on query/filter/sort change, appended
  // on Load more.
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const [conversations, setConversations] = useState<ConversationHit[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Remember the conversation the user was viewing when they first opened the
  // panel. Esc on the input restores it — typing then escaping doesn't strand
  // them on an empty search page.
  const preSearchKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey !== 'tool:search' && !preSearchKeyRef.current) {
      preSearchKeyRef.current = activeKey;
    }
  }, [activeKey]);

  const contactByPk = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contacts) m.set(c.publicKeyHex, c.name);
    return m;
  }, [contacts]);
  const channelByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const ch of channels) m.set(ch.key, ch.name);
    return m;
  }, [channels]);
  const conversationOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [];
    for (const ch of channels) opts.push({ key: ch.key, label: `# ${ch.name}` });
    for (const c of contacts) opts.push({ key: c.key, label: `@ ${c.name}` });
    return opts;
  }, [channels, contacts]);

  // Sender options. Three groups: Me, known contacts (by pubkey), and channel
  // speakers we've observed in messagesByKey but don't have as contacts —
  // these come through as `name:Alice` or the literal 'unknown' from the
  // protocol layer. Without surfacing them, you can't filter messages from a
  // public-channel poster you haven't yet added.
  const observedUnknownSenders = useMemo(() => {
    const known = new Set(contacts.map((c) => c.publicKeyHex));
    const out = new Map<string, string>(); // value → display label
    for (const list of Object.values(messagesByKey)) {
      for (const m of list) {
        const pk = m.fromPublicKeyHex;
        if (!pk || known.has(pk)) continue;
        if (out.has(pk)) continue;
        if (pk === 'unknown') out.set(pk, 'Unknown sender');
        else if (pk.startsWith('name:')) out.set(pk, pk.slice(5));
        else out.set(pk, shortPk(pk));
      }
    }
    return out;
  }, [messagesByKey, contacts]);

  // Auto-focus on mount so opening the panel from the Tools menu lands the
  // cursor in the field. Skip when the user is already typing into another
  // input (the LeftNav sidebar search) — otherwise we'd steal focus
  // mid-keystroke and select() would replace their first character with the
  // next one they type.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Page 0 fetch — fires whenever the effective query changes. Debounced so
  // typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (!client || !searchQuery.trim()) {
      setMessages([]);
      setConversations([]);
      setTotalMessages(0);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const r: SearchResultsPayload = await api.search(client, {
          query: searchQuery,
          sort,
          kinds: filters.kinds,
          key: filters.key,
          fromPk: filters.fromPk,
          tsFrom: filters.tsFrom,
          tsTo: filters.tsTo,
          limit: PAGE_LIMIT,
          offset: 0,
        });
        if (cancelled) return;
        setMessages(r.messages);
        setConversations(r.conversations);
        setTotalMessages(r.total.messages);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    client,
    searchQuery,
    sort,
    filters.kinds,
    filters.key,
    filters.fromPk,
    filters.tsFrom,
    filters.tsTo,
  ]);

  const onLoadMore = useCallback(async () => {
    if (!client || loadingMore || messages.length >= totalMessages) return;
    setLoadingMore(true);
    try {
      const r: SearchResultsPayload = await api.search(client, {
        query: searchQuery,
        sort,
        kinds: filters.kinds,
        key: filters.key,
        fromPk: filters.fromPk,
        tsFrom: filters.tsFrom,
        tsTo: filters.tsTo,
        limit: PAGE_LIMIT,
        offset: messages.length,
      });
      // Concatenate — server returns the next page, not the cumulative set.
      // Total can drift slightly under concurrent inserts; trust the latest.
      setMessages((prev) => [...prev, ...r.messages]);
      setTotalMessages(r.total.messages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [client, loadingMore, messages.length, totalMessages, searchQuery, sort, filters]);

  const onConversationClick = useCallback(
    (hit: ConversationHit) => {
      setActiveKey(hit.key);
    },
    [setActiveKey],
  );

  const onMessageClick = useCallback(
    (hit: MessageHit) => {
      setActiveKey(hit.key);
      setPendingJump(hit.id);
    },
    [setActiveKey, setPendingJump],
  );

  // Esc on the input: clear, restore prior conversation, blur.
  const onEscape = useCallback(() => {
    clearSearch();
    const prior = preSearchKeyRef.current;
    if (prior && prior !== 'tool:search') setActiveKey(prior);
    preSearchKeyRef.current = null;
    inputRef.current?.blur();
  }, [clearSearch, setActiveKey]);

  // Sort toggle: update session sort AND persist to AppSettings.search.defaultSort
  // so the user's preference sticks across launches. Fire-and-forget on the
  // PUT — the local store update is what makes the panel re-query.
  const changeSort = useCallback(
    (next: SearchSort) => {
      setSort(next);
      if (client && appSettings.search?.defaultSort !== next) {
        void api
          .putAppSettings(client, {
            ...appSettings,
            search: { ...appSettings.search, defaultSort: next },
          })
          .catch(() => {
            // Persistence failure is non-fatal — the current session still
            // uses the new sort; we'll just lose it on restart.
          });
      }
    },
    [setSort, client, appSettings],
  );

  const toggleKind = (k: 'channel' | 'dm') => {
    const has = filters.kinds.includes(k);
    const next = has ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k];
    // Don't allow zero kinds — would silently hide all messages. Treat the
    // second-toggle-off as "select only the other one" which the user
    // intends.
    if (next.length === 0) setFilters({ kinds: [k === 'channel' ? 'dm' : 'channel'] });
    else setFilters({ kinds: next });
  };

  const hasQuery = searchQuery.trim().length > 0;
  const hasResults = conversations.length > 0 || messages.length > 0;
  const empty = hasQuery && !loading && !error && !hasResults;
  const canLoadMore = messages.length < totalMessages;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-cs-text-dim"
          />
          <input
            ref={inputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onEscape();
              }
            }}
            placeholder="Search messages, channels, and contacts…"
            className="h-9 w-full rounded-md border border-cs-border bg-cs-bg-3 pl-8 pr-9 text-sm text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
          />
          {loading && (
            <Loader2
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 animate-spin text-cs-text-muted"
            />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <FilterChip
            label="Channels"
            active={filters.kinds.includes('channel')}
            onClick={() => toggleKind('channel')}
          />
          <FilterChip
            label="DMs"
            active={filters.kinds.includes('dm')}
            onClick={() => toggleKind('dm')}
          />
          <select
            value={filters.key ?? ''}
            onChange={(e) => setFilters({ key: e.target.value || undefined })}
            aria-label="Restrict to conversation"
            className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-cs-text outline-none focus:border-cs-accent"
          >
            <option value="">Any conversation</option>
            {conversationOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={filters.fromPk ?? ''}
            onChange={(e) => setFilters({ fromPk: e.target.value || undefined })}
            aria-label="Restrict to sender"
            className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-cs-text outline-none focus:border-cs-accent"
          >
            <option value="">Anyone</option>
            <option value="self">Me</option>
            {contacts.length > 0 && (
              <optgroup label="Contacts">
                {contacts.map((c) => (
                  <option key={c.publicKeyHex} value={c.publicKeyHex}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
            {observedUnknownSenders.size > 0 && (
              <optgroup label="Channel speakers">
                {[...observedUnknownSenders.entries()].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <DateInput
            value={filters.tsFrom}
            onChange={(v) => setFilters({ tsFrom: v })}
            placeholder="From"
            endOfDay={false}
          />
          <DateInput
            value={filters.tsTo}
            onChange={(v) => setFilters({ tsTo: v })}
            placeholder="To"
            endOfDay
          />
          <div className="ml-auto flex items-center gap-1 rounded-md border border-cs-border bg-cs-bg-3 p-0.5">
            <SortPill
              label="Recency"
              active={sort === 'recency'}
              onClick={() => changeSort('recency')}
            />
            <SortPill
              label="Relevance"
              active={sort === 'relevance'}
              onClick={() => changeSort('relevance')}
            />
          </div>
        </div>
      </header>

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
            {conversations.length > 0 && (
              <Section title={`Conversations (${conversations.length})`}>
                <ul className="divide-y divide-cs-border">
                  {conversations.map((hit) => (
                    <ConversationRow
                      key={hit.key}
                      hit={hit}
                      onClick={() => onConversationClick(hit)}
                    />
                  ))}
                </ul>
              </Section>
            )}
            {messages.length > 0 && (
              <Section title={`Messages (${messages.length} of ${totalMessages})`}>
                <ul className="space-y-1">
                  {messages.map((hit) => (
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
                          : (owner?.name ?? 'me')
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
                    {loadingMore
                      ? 'Loading…'
                      : `Load more (${totalMessages - messages.length} more)`}
                  </button>
                )}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 rounded-md border px-2 transition-colors',
        active
          ? 'border-cs-accent bg-cs-accent-soft/20 text-cs-text'
          : 'border-cs-border bg-cs-bg-3 text-cs-text-muted hover:text-cs-text',
      )}
    >
      {label}
    </button>
  );
}

function SortPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-6 rounded px-2 text-[11px] transition-colors',
        active ? 'bg-cs-accent-soft/40 text-cs-text' : 'text-cs-text-muted hover:text-cs-text',
      )}
    >
      {label}
    </button>
  );
}

function DateInput({
  value,
  onChange,
  placeholder,
  endOfDay,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder: string;
  /** When true, parse the picked date as end-of-day so a "To: today" filter
   *  includes today's later messages instead of stopping at midnight. */
  endOfDay: boolean;
}) {
  // Round-trip: display the local date the timestamp falls in (not UTC),
  // emit local-midnight (+ end-of-day fudge for tsTo).
  const str = value
    ? (() => {
        const d = new Date(value);
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${mo}-${day}`;
      })()
    : '';
  return (
    <input
      type="date"
      value={str}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) {
          onChange(undefined);
          return;
        }
        const [y, mo, day] = v.split('-').map(Number);
        const ts = new Date(y, mo - 1, day).getTime();
        onChange(endOfDay ? ts + END_OF_DAY_MS : ts);
      }}
      aria-label={placeholder}
      title={placeholder}
      className="h-7 rounded-md border border-cs-border bg-cs-bg-3 px-2 text-cs-text outline-none focus:border-cs-accent"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-cs-text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ConversationRow({ hit, onClick }: { hit: ConversationHit; onClick: () => void }) {
  const Icon = hit.kind === 'channel' ? Hash : (CONTACT_KIND_ICON.chat ?? User);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-cs-text transition-colors hover:bg-cs-bg-2"
      >
        <Icon size={14} className="text-cs-text-muted" aria-hidden="true" />
        <span className="truncate">{hit.name}</span>
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

function MessageRow({
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

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Search className="size-5 text-cs-text-dim" aria-hidden="true" />
      <h2 className="font-mono text-[11px] uppercase tracking-wider text-cs-text-muted">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-cs-text-dim">{body}</p>
    </div>
  );
}
