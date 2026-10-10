import { defaultFilter } from 'cmdk';
import { useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/ui/command';
import { Kbd } from '../../components/ui/kbd';
import type { ApiClient } from '../../lib/api';
import { loadLastDevice } from '../../lib/lastDevice';
import { useStore } from '../../lib/store';
import { buildActionItems } from './items/actions';
import { buildGotoItems } from './items/goto';
import { buildPinnedItems } from './items/pinned';
import { buildRecentItems } from './items/recent';
import { GROUP_LABEL, type PaletteGroup, type PaletteItem } from './types';

// Smaller, filled key-cap look for the palette footer hints (overrides the
// shared Kbd's default outline/size).
const FOOTER_KBD_CLS = 'h-auto min-w-0 border-cs-border bg-cs-bg-3 px-1 py-px text-[10px]';

interface Props {
  client: ApiClient | null;
  cycleThemePref: () => void;
}

/**
 * Builds a cmdk filter that ranks palette matches by where they hit. cmdk's
 * default filter scores one concatenated string, so a query can match a
 * description word (e.g. "radio" in BLE Connect's "Scan + connect a radio")
 * and outrank a real label match ("Radio Settings") — command-score even
 * penalizes the Title-cased label.
 *
 * Each CommandItem passes keywords as [label, hint, extraKeywords]. The label
 * is scored at full weight; the hint/keywords are scaled by `hintWeight`
 * (0 = ignore description text, 1 = rank it equal to the label). The weight is
 * user-tunable via AppSettings.commandPalette.hintWeightPct.
 */
function makePaletteFilter(hintWeight: number) {
  return (_value: string, search: string, keywords?: string[]): number => {
    const [label = '', hint = '', extra = ''] = keywords ?? [];
    const labelScore = defaultFilter(label, search);
    const secondaryScore = defaultFilter(`${hint} ${extra}`.trim(), search);
    return Math.max(labelScore, secondaryScore * hintWeight);
  };
}

export function CommandPalette({ client, cycleThemePref }: Props) {
  const open = useStore((s) => s.paletteOpen);
  const close = useStore((s) => s.closePalette);
  const hintWeightPct = useStore((s) => s.appSettings.commandPalette.hintWeightPct);
  const paletteFilter = useMemo(() => makePaletteFilter(hintWeightPct / 100), [hintWeightPct]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="Command palette"
      description="Search channels, contacts, tools, and actions"
      filter={paletteFilter}
      showCloseButton={false}
      className="border-cs-border bg-cs-bg sm:max-w-xl"
    >
      {/* The dialog content (and so PaletteBody) is only mounted while open or
          animating closed, so a closed palette doesn't subscribe to packets
          and messages or rebuild its items on every RX. */}
      <PaletteBody client={client} cycleThemePref={cycleThemePref} close={close} />
    </CommandDialog>
  );
}

function PaletteBody({ client, cycleThemePref, close }: Props & { close: () => void }) {
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const recentKeys = useStore((s) => s.ui.recentKeys);
  const pinnedKeys = useStore((s) => s.ui.pinned);
  const activeKey = useStore((s) => s.ui.activeKey);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const togglePin = useStore((s) => s.togglePin);
  const toggleLeftNav = useStore((s) => s.toggleLeftNav);
  const toggleRightRail = useStore((s) => s.toggleRightRail);
  const transportState = useStore((s) => s.transportState);
  const owner = useStore((s) => s.owner);
  const packetCount = useStore((s) => s.packets.length);
  const messagesByKey = useStore((s) => s.messagesByKey);
  const lastReadByKey = useStore((s) => s.ui.lastReadByKey);
  const markAllRead = useStore((s) => s.markAllRead);
  const markAllReadGlobal = useStore((s) => s.markAllReadGlobal);
  const clearPackets = useStore((s) => s.clearPackets);
  const setAddChannelOpen = useStore((s) => s.setAddChannelOpen);

  // Read on mount: the body mounts when the palette opens.
  const lastDevice = useMemo(() => loadLastDevice(), []);

  const items = useMemo<PaletteItem[]>(() => {
    const activeContact = contacts.find((c) => c.key === activeKey);
    return [
      ...buildRecentItems({ recentKeys, activeKey, channels, contacts, setActiveKey, close }),
      ...buildPinnedItems({ pinnedKeys, activeKey, channels, contacts, setActiveKey, close }),
      ...buildActionItems({
        client,
        close,
        cycleThemePref,
        toggleLeftNav,
        toggleRightRail,
        togglePin,
        setActiveKey,
        setAddChannelOpen,
        markAllRead,
        markAllReadGlobal,
        clearPackets,
        lastDevice,
        transportState,
        owner,
        packetCount,
        activeKey,
        activeContact,
      }),
      ...buildGotoItems({
        channels,
        contacts,
        activeKey,
        messagesByKey,
        lastReadByKey,
        setActiveKey,
        close,
      }),
    ];
  }, [
    channels,
    contacts,
    recentKeys,
    pinnedKeys,
    activeKey,
    client,
    setActiveKey,
    close,
    cycleThemePref,
    toggleLeftNav,
    toggleRightRail,
    togglePin,
    lastDevice,
    transportState,
    owner,
    packetCount,
    messagesByKey,
    lastReadByKey,
    markAllRead,
    markAllReadGlobal,
    clearPackets,
    setAddChannelOpen,
  ]);

  // Sections follow the order their first item appears in.
  const groupedItems = useMemo(() => {
    const groups = new Map<PaletteGroup, PaletteItem[]>();
    for (const item of items) {
      const bucket = groups.get(item.group);
      if (bucket) bucket.push(item);
      else groups.set(item.group, [item]);
    }
    return [...groups.entries()].map(([group, groupItems]) => ({ group, items: groupItems }));
  }, [items]);

  return (
    <>
      <CommandInput placeholder="Type to search channels, contacts, tools, actions…" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No matches. Try: advert, scan, unread, theme…</CommandEmpty>
        {groupedItems.map(({ group, items: groupItems }) => (
          <CommandGroup key={group} heading={GROUP_LABEL[group]}>
            {groupItems.map((it) => {
              const Icon = it.icon;
              return (
                <CommandItem
                  key={it.id}
                  value={it.id}
                  keywords={[it.label, it.hint ?? '', it.keywords ?? '']}
                  onSelect={() => it.run()}
                >
                  <Icon aria-hidden="true" />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="truncate text-[10px] text-cs-text-dim">{it.hint}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
      <footer className="flex shrink-0 items-center gap-3 border-t border-cs-border bg-cs-bg-2 px-3 py-1.5 text-[10px] text-cs-text-dim">
        <Kbd className={FOOTER_KBD_CLS}>↑↓</Kbd> navigate
        <Kbd className={FOOTER_KBD_CLS}>↵</Kbd> run
        <Kbd className={FOOTER_KBD_CLS}>esc</Kbd> close
      </footer>
    </>
  );
}
