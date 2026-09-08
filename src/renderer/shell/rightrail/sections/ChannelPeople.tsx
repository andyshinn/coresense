import { memo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { Channel, ChannelStats, PeopleFilter, PeopleSort } from '../../../../shared/types';
import { Skeleton } from '../../../components/ui/skeleton';
import { useChannelStats } from '../../../hooks/useChannelStats';
import { useNowTick } from '../../../hooks/useNowTick';
import { type ApiClient, api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { railIsWide } from '../railWidth';
import { useRailSettleTick } from '../useRailSettleTick';
import { PeopleControls } from './PeopleControls';
import { PeopleRow } from './PeopleRow';
import {
  capRows,
  filterRoster,
  groupByBucket,
  maxCount,
  PEOPLE_ROW_CAP,
  type RosterRow,
  sortRoster,
  toRosterRows,
} from './peopleModel';

interface BodyProps {
  stats: ChannelStats | null;
  /** At or above RAIL_COLLAPSE_WIDTH. A boolean, never the px width: the raw
   *  width changes on every drag frame and would re-render every row with it. */
  wide: boolean;
  sort: PeopleSort;
  filter: PeopleFilter;
  query: string;
  onQuery: (q: string) => void;
  onSort: (s: PeopleSort) => void;
  onFilter: (f: PeopleFilter) => void;
  onOpenContact: (contactKey: string) => void;
  /** Save a poster we have a pubkey for. Only ever called for rows whose
   *  UserPlus is enabled, i.e. `pubkey !== null && !inContacts && !blocked`. */
  onAddContact: (row: RosterRow) => void;
  /** Identity of the roster on screen. The section does not remount when the
   *  channel changes (the rail keys its Collapsible on a constant section id),
   *  so this is what collapses an expanded list back to the cap. */
  resetKey?: string;
}

export function ChannelPeopleBody({
  stats,
  wide,
  sort,
  filter,
  query,
  onQuery,
  onSort,
  onFilter,
  onOpenContact,
  onAddContact,
  resetKey = '',
}: BodyProps) {
  const now = useNowTick();
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  // Not `s.ui.rightWidth`: rows re-measure clipping against the real px width,
  // but only need to be *told* to; this ticks once per settled drag instead of
  // once per frame.
  const settleTick = useRailSettleTick();
  // Which roster the user asked to see in full. Comparing against `resetKey`
  // rather than resetting in an effect means a channel switch collapses the
  // list during the same render, with no intermediate uncapped paint.
  const [expandedFor, setExpandedFor] = useState<string | null>(null);

  // Everything below is hoisted ABOVE the `stats === null` early return: hooks
  // must run in the same order on every render, and the skeleton path returns
  // before the list is ever derived. `stats?.roster ?? []` covers that case.
  const roster = stats?.roster;
  const all = useMemo(() => toRosterRows(roster ?? [], contacts, discovered), [roster, contacts, discovered]);
  const shown = useMemo(() => sortRoster(filterRoster(all, filter, query), sort), [all, filter, query, sort]);
  const max = useMemo(() => maxCount(shown), [shown]);

  // Search and filter run over the FULL roster above; only the paint is capped,
  // so the header count and every search result stay complete.
  const expanded = expandedFor === resetKey;
  const { rows: visible, hidden } = useMemo(
    () => (expanded ? { rows: shown, hidden: 0 } : capRows(shown, PEOPLE_ROW_CAP)),
    [shown, expanded],
  );
  const buckets = useMemo(() => (sort === 'recent' ? groupByBucket(visible, now) : []), [visible, now, sort]);

  const showVolume = wide && sort !== 'name';

  // onOpen and onMessage are the same action today (both just open the
  // contact), kept as one shared handler rather than two byte-identical
  // closures — PeopleRow still calls them by their own names since they are
  // conceptually distinct actions (row click vs. the message affordance) that
  // simply happen to coincide for now.
  const onRowAction = useCallback(
    (r: RosterRow) => {
      if (r.contactKey) onOpenContact(r.contactKey);
    },
    [onOpenContact],
  );

  // Every member must be referentially stable across a drag frame or `PeopleRow`'s
  // memo comparator fails and all of them re-render anyway — which is exactly
  // what the raw `railWidth` member used to do.
  const rowProps = useMemo(
    () => ({
      now,
      maxCount: max,
      showVolume,
      remeasureAt: settleTick,
      timeFormat,
      onOpen: onRowAction,
      onMessage: onRowAction,
      onAddContact,
    }),
    [now, max, showVolume, settleTick, timeFormat, onRowAction, onAddContact],
  );

  // `stats === null` is the single source of truth for "no data yet" — it
  // covers the in-flight fetch AND the client === null case (which never
  // fetches, so `loading` never turns true and previously stuck this guard
  // open forever). Genuine emptiness requires stats to have actually
  // resolved; otherwise the very first painted frame (loading hasn't flipped
  // true yet, stats is still null) would flash this same "no one heard"
  // message before the skeletons ever show.
  if (stats === null) {
    return (
      <div className="flex flex-col gap-1 px-2.5 py-1">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (all.length === 0) {
    return <EmptyNote>No one has been heard in this channel yet.</EmptyNote>;
  }

  return (
    <div className="pb-1.5">
      <PeopleControls
        query={query}
        sort={sort}
        filter={filter}
        showToggles={wide}
        onQuery={onQuery}
        onSort={onSort}
        onFilter={onFilter}
      />

      {shown.length === 0 ? (
        query ? (
          <EmptyNote>
            No one matches "<span className="text-cs-text-muted">{query}</span>". Clear the search to see all {all.length}.
          </EmptyNote>
        ) : (
          <EmptyNote>No one matches that filter.</EmptyNote>
        )
      ) : sort === 'recent' ? (
        buckets.map((bucket) => (
          <div key={bucket.id}>
            <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-[13px] first:pt-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-cs-text-dim">{bucket.label}</span>
              <span className="font-mono text-[9px] text-cs-text-dim opacity-75">{bucket.rows.length}</span>
              <span aria-hidden className="h-px flex-1 bg-cs-border" />
            </div>
            {bucket.rows.map((r) => (
              <PeopleRow key={r.id} row={r} {...rowProps} />
            ))}
          </div>
        ))
      ) : (
        visible.map((r) => <PeopleRow key={r.id} row={r} {...rowProps} />)
      )}

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpandedFor(resetKey)}
          className="mt-1 w-full px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.08em] text-cs-text-dim hover:text-cs-text"
        >
          Show all {shown.length}
          <span className="ml-1.5 normal-case tracking-normal opacity-75">({hidden} more)</span>
        </button>
      )}
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-[11.5px] text-cs-text-dim">{children}</p>;
}

/** Header count: `156`, or `«n» / 156` while a query or filter narrows it.
 *
 *  Memoised because the rail evaluates `trailing={section.trailing?.()}` outside
 *  the Collapsible's open guard, so this re-derives the roster even while the
 *  People section is collapsed — once per drag frame, before the memo. */
export const ChannelPeopleCount = memo(function ChannelPeopleCount({
  channel,
  client,
}: {
  channel: Channel;
  client: ApiClient | null;
}) {
  const { stats } = useChannelStats(channel.key, client);
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const query = useStore((s) => s.peopleQuery);
  const prefs = useStore((s) => s.ui.peopleRail[channel.key]);
  const filter = prefs?.filter ?? 'all';

  const roster = stats?.roster;
  const all = useMemo(() => toRosterRows(roster ?? [], contacts, discovered), [roster, contacts, discovered]);
  // Counts the FULL roster, never the capped list the body paints.
  const shown = useMemo(() => filterRoster(all, filter, query), [all, filter, query]);

  if (all.length === 0) return null;
  const narrowed = query !== '' || filter !== 'all';

  return (
    <span className="font-mono text-[10px] tabular-nums text-cs-text-dim">
      {narrowed ? `${shown.length} / ${all.length}` : all.length}
    </span>
  );
});

export const ChannelPeopleSection = memo(function ChannelPeopleSection({
  channel,
  client,
}: {
  channel: Channel;
  client: ApiClient | null;
}) {
  const { stats } = useChannelStats(channel.key, client);
  // A boolean, not `s.ui.rightWidth` — see railIsWide. Subscribing to the px
  // value here would re-render this section (and therefore the whole roster) on
  // every drag frame no matter how many memo boundaries sit below it.
  const wide = useStore((s) => railIsWide(s.ui.rightWidth));
  const query = useStore((s) => s.peopleQuery);
  const setQuery = useStore((s) => s.setPeopleQuery);
  const prefs = useStore((s) => s.ui.peopleRail[channel.key]);
  const setPeopleRail = useStore((s) => s.setPeopleRail);
  const setActiveKey = useStore((s) => s.setActiveKey);

  // The rail keys its Collapsible on a constant section id, so this component
  // does NOT remount when the channel changes. Clear the query explicitly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channel.key is the remount-equivalent trigger, not read inside the effect
  useEffect(() => {
    setQuery('');
  }, [channel.key, setQuery]);

  // `peopleQuery` is store-root state, so it outlives this component: the
  // Collapsible (Collapsible.tsx) only mounts this section's body while open,
  // but `ChannelPeopleCount` renders the header count from outside that
  // guard. Without this, collapsing the section (or switching channels, which
  // also unmounts+remounts this section under the section's constant id)
  // leaves a stale query in the store with no visible control to clear it —
  // the header count silently stays narrowed by a search box that is no
  // longer on screen. This composes with the effect above rather than
  // fighting it: that one clears on channel-key change while mounted, this
  // one clears on unmount (collapse), and calling setQuery('') twice is
  // harmless.
  useEffect(() => () => setQuery(''), [setQuery]);

  // Same call the Contact Manager uses to promote a discovered node to a saved
  // radio contact (ContactDetail.tsx / ContactRows.tsx): only the pubkey is
  // required. Only ever invoked for a row whose UserPlus is enabled, i.e. one
  // that already resolved a pubkey from the advert-derived discovered pool.
  const addContact = useCallback(
    async (row: RosterRow) => {
      if (!client || !row.pubkey) return;
      try {
        await api.addToRadio(client, row.pubkey);
        notify.success(`Added ${row.name} to radio`);
      } catch (err) {
        notify.error(`Add failed: ${(err as Error).message}`, err);
      }
    },
    [client],
  );

  const onSort = useCallback((sort: PeopleSort) => setPeopleRail(channel.key, { sort }), [channel.key, setPeopleRail]);
  const onFilter = useCallback(
    (filter: PeopleFilter) => setPeopleRail(channel.key, { filter }),
    [channel.key, setPeopleRail],
  );

  return (
    <ChannelPeopleBody
      stats={stats}
      wide={wide}
      sort={prefs?.sort ?? 'recent'}
      filter={prefs?.filter ?? 'all'}
      query={query}
      onQuery={setQuery}
      onSort={onSort}
      onFilter={onFilter}
      onOpenContact={setActiveKey}
      onAddContact={addContact}
      resetKey={channel.key}
    />
  );
});
