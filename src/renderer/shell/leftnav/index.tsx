import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { ContextMenu, menuItem } from '../../components/ContextMenu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from '../../components/ui/sidebar';
import { useUnreadByKey } from '../../hooks/useUnreads';
import { useStore } from '../../lib/store';
import { ChannelContextMenu, type ChannelMenuState } from './ChannelContextMenu';
import { ChannelsBranch } from './ChannelsBranch';
import { ConnectionFooter } from './ConnectionFooter';
import { ContactContextMenu, type ContactMenuState } from './ContactContextMenu';
import { ContactsTree } from './ContactsTree';
import { LeftNavSearch } from './LeftNavSearch';
import { OwnerCard } from './OwnerCard';
import { ToolsGroup } from './ToolsGroup';
import { UnreadsNavItem } from './UnreadsNavItem';

/** The one context menu the nav can have open at a time. */
type NavMenu =
  | { kind: 'channel'; state: ChannelMenuState }
  | { kind: 'contact'; state: ContactMenuState }
  | { kind: 'channelsRow'; x: number; y: number };

/** Primary sidebar — owner card, channel/contact tree, tools, and connection footer. */
export function LeftNav() {
  const owner = useStore((s) => s.owner);
  const pinned = useStore((s) => s.ui.pinned);
  const activeKey = useStore((s) => s.ui.activeKey);
  const transport = useStore((s) => s.transportState);
  const syncProgress = useStore((s) => s.syncProgress);
  const showLeftNavUnreads = useStore((s) => s.appSettings.showLeftNavUnreads);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const setAddChannelOpen = useStore((s) => s.setAddChannelOpen);
  const togglePin = useStore((s) => s.togglePin);
  const connected = transport === 'connected';

  // Per-conversation unread counts, shared with the Unreads panel.
  const unreadByKey = useUnreadByKey();
  const totalUnread = useMemo(() => Object.values(unreadByKey).reduce((a, b) => a + b, 0), [unreadByKey]);

  const pinSet = useMemo(() => new Set(pinned), [pinned]);

  const [menu, setMenu] = useState<NavMenu | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openChannelMenu = useCallback((state: ChannelMenuState) => setMenu({ kind: 'channel', state }), []);
  const openContactMenu = useCallback((state: ContactMenuState) => setMenu({ kind: 'contact', state }), []);
  const openChannelsRowMenu = useCallback((x: number, y: number) => setMenu({ kind: 'channelsRow', x, y }), []);

  // Per-branch "user clicked Show more" flags. Session-only by design — each
  // launch starts collapsed back to the limit so a bloated branch can't
  // permanently wedge the nav into a multi-hundred-row scroll.
  const collapseListsEnabled = useStore((s) => s.appSettings.leftNavCollapseLists.enabled);
  const collapseListsLimit = useStore((s) => s.appSettings.leftNavCollapseLists.limit);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const revealList = useCallback((key: string) => {
    setRevealed((m) => ({ ...m, [key]: true }));
  }, []);
  const capFor = useCallback(
    (key: string) => (collapseListsEnabled && !revealed[key] ? collapseListsLimit : null),
    [collapseListsEnabled, collapseListsLimit, revealed],
  );

  return (
    <Sidebar collapsible="icon" aria-label="Primary navigation">
      <SidebarHeader>
        <OwnerCard owner={owner} />
      </SidebarHeader>

      <SidebarContent className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <LeftNavSearch />
        <SidebarGroup>
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarMenu>
            {showLeftNavUnreads && (
              <UnreadsNavItem
                totalUnread={totalUnread}
                isActive={activeKey === 'tool:unreads'}
                onSelect={() => setActiveKey('tool:unreads')}
              />
            )}
            <ChannelsBranch
              connected={connected}
              activeKey={activeKey}
              pinned={pinned}
              pinSet={pinSet}
              unreadByKey={unreadByKey}
              cap={capFor('channels')}
              onShowMore={() => revealList('channels')}
              onChannelMenu={openChannelMenu}
              onBranchMenu={openChannelsRowMenu}
            />
            <ContactsTree
              activeKey={activeKey}
              pinned={pinned}
              pinSet={pinSet}
              unreadByKey={unreadByKey}
              capFor={capFor}
              onShowMore={revealList}
              onContactMenu={openContactMenu}
            />
          </SidebarMenu>
        </SidebarGroup>

        <ToolsGroup activeKey={activeKey} />
      </SidebarContent>

      <SidebarFooter>
        <ConnectionFooter
          state={transport}
          sync={syncProgress}
          onClick={() => setActiveKey('tool:bleconnect')}
          active={activeKey === 'tool:bleconnect'}
        />
      </SidebarFooter>

      <SidebarRail />

      {menu?.kind === 'channel' && (
        <ChannelContextMenu
          state={menu.state}
          isPinned={pinSet.has(menu.state.channel.key)}
          onTogglePin={togglePin}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'contact' && (
        <ContactContextMenu
          state={menu.state}
          isPinned={pinSet.has(menu.state.contact.key)}
          onTogglePin={togglePin}
          onClose={closeMenu}
        />
      )}
      {menu?.kind === 'channelsRow' && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            menuItem('Add channel…', () => setAddChannelOpen(true), {
              icon: Plus,
              disabled: !connected,
            }),
          ]}
          onClose={closeMenu}
        />
      )}
    </Sidebar>
  );
}
