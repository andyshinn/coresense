import { Hash, Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { errorMessage } from '../../../shared/errors';
import { AddChannelPopover } from '../../components/AddChannelPopover';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { SidebarMenuAction } from '../../components/ui/sidebar';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { EmptySubHint } from './atoms';
import type { ChannelMenuState } from './ChannelContextMenu';
import { ChannelSubList } from './ChannelSubList';
import { ParentBranch } from './ParentBranch';
import { sortChannels } from './sorting';

/** The "Channels" branch: its add-channel popover and the sorted, capped,
 *  drag-reorderable channel list. */
export function ChannelsBranch({
  client,
  connected,
  activeKey,
  pinned,
  pinSet,
  unreadByKey,
  cap,
  onShowMore,
  onChannelMenu,
  onBranchMenu,
}: {
  client: ApiClient | null;
  connected: boolean;
  activeKey: string;
  pinned: string[];
  pinSet: Set<string>;
  unreadByKey: Record<string, number>;
  /** Max rows before the Show-more affordance; `null` when uncapped or revealed. */
  cap: number | null;
  onShowMore: () => void;
  onChannelMenu: (state: ChannelMenuState) => void;
  /** Right-click on the branch row itself (only offered while connected). */
  onBranchMenu: (x: number, y: number) => void;
}) {
  const channels = useStore((s) => s.channels);
  const channelPresence = useStore((s) => s.channelPresence);
  const hideUnsynced = useStore((s) => s.appSettings.hideUnsyncedChannels);
  const pinUnreadToTop = useStore((s) => s.appSettings.pinUnreadToTop);
  const open = useStore((s) => s.ui.leftNavOpen.channels);
  const setLeftNavGroup = useStore((s) => s.setLeftNavGroup);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const addChannelOpen = useStore((s) => s.addChannelOpen);
  const setAddChannelOpen = useStore((s) => s.setAddChannelOpen);

  // Sort channels: pinned first (in pin order), then by `order` (seeded from
  // radio idx on first sync), then alphabetical. Filter out unsynced channels
  // when the user has opted into device-only parity.
  const sortedChannels = useMemo(() => {
    const filtered = hideUnsynced ? channels.filter((c) => channelPresence.has(c.key)) : channels;
    return sortChannels(filtered, pinSet, pinned, pinUnreadToTop ? unreadByKey : null);
  }, [channels, channelPresence, hideUnsynced, pinSet, pinned, pinUnreadToTop, unreadByKey]);

  const onReorder = useCallback(
    async (orderedKeys: string[]) => {
      if (!client) return;
      try {
        await api.reorderChannels(client, orderedKeys);
      } catch (err) {
        notify.error(`Reorder failed: ${errorMessage(err)}`, err);
      }
    },
    [client],
  );

  return (
    <Popover open={addChannelOpen} onOpenChange={setAddChannelOpen}>
      <ParentBranch
        label="Channels"
        icon={Hash}
        open={open}
        onToggle={() => setLeftNavGroup('channels', !open)}
        onContextMenu={(e) => {
          if (!connected) return;
          e.preventDefault();
          onBranchMenu(e.clientX, e.clientY);
        }}
        trailingAction={
          <SidebarMenuAction
            asChild
            aria-label="Add channel"
            title={connected ? 'Add channel' : 'Connect a radio to add channels'}
            disabled={!connected}
            onClick={(e) => {
              // Don't let the click bubble up to SidebarMenuButton, which would toggle the collapsible.
              e.stopPropagation();
            }}
            className="text-cs-text-dim hover:text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PopoverTrigger asChild>
              <button type="button">
                <Plus className="size-3" />
              </button>
            </PopoverTrigger>
          </SidebarMenuAction>
        }
      >
        {sortedChannels.length === 0 ? (
          <EmptySubHint>{connected ? 'No channels on this radio.' : 'Connect a radio to sync channels.'}</EmptySubHint>
        ) : (
          <ChannelSubList
            channels={sortedChannels}
            activeKey={activeKey}
            pinSet={pinSet}
            presence={channelPresence}
            unreadByKey={unreadByKey}
            cap={cap}
            onShowMore={onShowMore}
            onSelect={setActiveKey}
            onReorder={onReorder}
            onContext={(channel, e) => {
              e.preventDefault();
              onChannelMenu({
                channel,
                onDevice: channelPresence.has(channel.key),
                x: e.clientX,
                y: e.clientY,
              });
            }}
          />
        )}
      </ParentBranch>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          // Let the form's autoFocus input win instead of Radix's default
          // focus-to-content behavior.
          e.preventDefault();
        }}
      >
        <AddChannelPopover client={client} onClose={() => setAddChannelOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
