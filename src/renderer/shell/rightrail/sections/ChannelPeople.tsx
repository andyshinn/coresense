import { type ReactNode, useCallback, useEffect } from 'react';
import type { Channel, ChannelStats, PeopleFilter, PeopleSort } from '../../../../shared/types';
import { Skeleton } from '../../../components/ui/skeleton';
import { useChannelStats } from '../../../hooks/useChannelStats';
import { useNowTick } from '../../../hooks/useNowTick';
import { type ApiClient, api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { RAIL_COLLAPSE_WIDTH } from '../railWidth';
import { PeopleControls } from './PeopleControls';
import { PeopleRow } from './PeopleRow';
import { filterRoster, groupByBucket, maxCount, type RosterRow, sortRoster, toRosterRows } from './peopleModel';

interface BodyProps {
  stats: ChannelStats | null;
  railWidth: number;
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
}

export function ChannelPeopleBody({
  stats,
  railWidth,
  sort,
  filter,
  query,
  onQuery,
  onSort,
  onFilter,
  onOpenContact,
  onAddContact,
}: BodyProps) {
  const now = useNowTick();
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);

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

  const all = toRosterRows(stats.roster, contacts, discovered);
  if (all.length === 0) {
    return <EmptyNote>No one has been heard in this channel yet.</EmptyNote>;
  }

  const wide = railWidth >= RAIL_COLLAPSE_WIDTH;
  const shown = sortRoster(filterRoster(all, filter, query), sort);
  const max = maxCount(shown);
  const showVolume = wide && sort !== 'name';

  // onOpen and onMessage are the same action today (both just open the
  // contact), kept as one shared handler rather than two byte-identical
  // closures — PeopleRow still calls them by their own names since they are
  // conceptually distinct actions (row click vs. the message affordance) that
  // simply happen to coincide for now.
  const onRowAction = (r: RosterRow) => {
    if (r.contactKey) onOpenContact(r.contactKey);
  };

  const rowProps = {
    now,
    maxCount: max,
    showVolume,
    railWidth,
    timeFormat,
    onOpen: onRowAction,
    onMessage: onRowAction,
    onAddContact,
  };

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
        groupByBucket(shown, now).map((bucket) => (
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
        shown.map((r) => <PeopleRow key={r.id} row={r} {...rowProps} />)
      )}
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-[11.5px] text-cs-text-dim">{children}</p>;
}

/** Header count: `156`, or `«n» / 156` while a query or filter narrows it. */
export function ChannelPeopleCount({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats } = useChannelStats(channel.key, client);
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const query = useStore((s) => s.peopleQuery);
  const prefs = useStore((s) => s.ui.peopleRail[channel.key]);
  const filter = prefs?.filter ?? 'all';

  const all = toRosterRows(stats?.roster ?? [], contacts, discovered);
  if (all.length === 0) return null;
  const shown = filterRoster(all, filter, query);
  const narrowed = query !== '' || filter !== 'all';

  return (
    <span className="font-mono text-[10px] tabular-nums text-cs-text-dim">
      {narrowed ? `${shown.length} / ${all.length}` : all.length}
    </span>
  );
}

export function ChannelPeopleSection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats } = useChannelStats(channel.key, client);
  const railWidth = useStore((s) => s.ui.rightWidth);
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

  return (
    <ChannelPeopleBody
      stats={stats}
      railWidth={railWidth}
      sort={prefs?.sort ?? 'recent'}
      filter={prefs?.filter ?? 'all'}
      query={query}
      onQuery={setQuery}
      onSort={(sort) => setPeopleRail(channel.key, { sort })}
      onFilter={(filter) => setPeopleRail(channel.key, { filter })}
      onOpenContact={setActiveKey}
      onAddContact={addContact}
    />
  );
}
