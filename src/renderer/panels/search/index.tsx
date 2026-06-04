import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConversationHit,
  MessageHit,
  SearchResults as SearchResultsPayload,
  SearchSort,
} from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { applyCategorySelection } from './categoryFilter';
import { ResultsList } from './ResultsList';
import { SearchHeader } from './SearchHeader';

interface Props {
  client: ApiClient | null;
}

const DEBOUNCE_MS = 150;
const PAGE_LIMIT = 100;

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
  // next one they type. Re-runs when `searchFocusNonce` bumps so a global
  // Cmd/Ctrl+F refocuses the input even if the panel is already mounted.
  const searchFocusNonce = useStore((s) => s.searchFocusNonce);
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      // The nonce bump means the user explicitly hit Cmd/Ctrl+F — they want
      // focus *here*, even if another input currently holds it.
      if (active !== inputRef.current && searchFocusNonce === 0) return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [searchFocusNonce]);

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
          categories: filters.categories,
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
    filters.categories,
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
        categories: filters.categories,
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

  // Esc on the input: clear, restore prior conversation via back-nav, blur.
  // goBack() pops the entry typing pushed onto navPast and leaves tool:search
  // on navFuture so Cmd+Right returns here — browser-style.
  const onEscape = useCallback(() => {
    clearSearch();
    const prior = preSearchKeyRef.current;
    if (prior && prior !== 'tool:search') useStore.getState().goBack();
    preSearchKeyRef.current = null;
    inputRef.current?.blur();
  }, [clearSearch]);

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

  const onCategoriesChange = (next: string[]) => {
    setFilters({ categories: applyCategorySelection(next, filters.categories) });
  };

  const hasQuery = searchQuery.trim().length > 0;
  const hasResults = conversations.length > 0 || messages.length > 0;
  const empty = hasQuery && !loading && !error && !hasResults;
  const canLoadMore = messages.length < totalMessages;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SearchHeader
        inputRef={inputRef}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onEscape={onEscape}
        loading={loading}
        filters={filters}
        setFilters={setFilters}
        onCategoriesChange={onCategoriesChange}
        conversationOptions={conversationOptions}
        contacts={contacts}
        observedUnknownSenders={observedUnknownSenders}
        sort={sort}
        changeSort={changeSort}
      />
      <ResultsList
        hasQuery={hasQuery}
        loading={loading}
        error={error}
        empty={empty}
        searchQuery={searchQuery}
        hasResults={hasResults}
        conversations={conversations}
        messages={messages}
        totalMessages={totalMessages}
        channelByKey={channelByKey}
        contactByPk={contactByPk}
        ownerName={owner?.name ?? 'me'}
        canLoadMore={canLoadMore}
        loadingMore={loadingMore}
        onLoadMore={onLoadMore}
        onConversationClick={onConversationClick}
        onMessageClick={onMessageClick}
      />
    </div>
  );
}
