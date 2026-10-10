import { type DragEvent, type MouseEvent, useRef, useState } from 'react';
import type { Channel } from '../../../shared/types';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '../../components/ui/sidebar';
import { shouldShowUnread } from '../../hooks/useUnreads';
import { capList } from '../../lib/capList';
import { CHANNEL_ICON } from '../../lib/conversationIcons';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { ACTIVE_BUTTON_CLASS, NavRowTrailing, ShowMoreRow } from './atoms';

/** Sub-list of channel rows with drag-to-reorder, presence dimming, unread/mute/pin badges, and capped reveal. */
export function ChannelSubList({
  channels,
  activeKey,
  pinSet,
  presence,
  unreadByKey,
  cap,
  onShowMore,
  onSelect,
  onReorder,
  onContext,
}: {
  channels: Channel[];
  activeKey: string;
  pinSet: Set<string>;
  presence: Set<string>;
  unreadByKey: Record<string, number>;
  /** Max rows to render before the Show-more affordance; `null` when uncapped or revealed. */
  cap: number | null;
  onShowMore: () => void;
  onSelect: (key: string) => void;
  onReorder: (orderedKeys: string[]) => void;
  onContext: (channel: Channel, e: MouseEvent) => void;
}) {
  const dragKey = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const onDragStart = (e: DragEvent, key: string) => {
    dragKey.current = key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };
  const onDragOver = (e: DragEvent, key: string) => {
    if (!dragKey.current || dragKey.current === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(key);
  };
  const onDrop = (e: DragEvent, key: string) => {
    e.preventDefault();
    const src = dragKey.current;
    dragKey.current = null;
    setDragOver(null);
    if (!src || src === key) return;
    const keys = channels.map((c) => c.key);
    const from = keys.indexOf(src);
    const to = keys.indexOf(key);
    if (from === -1 || to === -1) return;
    keys.splice(from, 1);
    keys.splice(to, 0, src);
    onReorder(keys);
  };

  const { rows: shown, hidden } = capList(channels, cap);
  const windowFocused = useStore((s) => s.windowFocused);
  return (
    <SidebarMenuSub>
      {shown.map((ch) => {
        const onDevice = presence.has(ch.key);
        const Icon = CHANNEL_ICON[ch.kind];
        const unread = unreadByKey[ch.key] ?? 0;
        const active = activeKey === ch.key;
        const showUnread = shouldShowUnread(unread, active, windowFocused);
        return (
          <SidebarMenuSubItem
            key={ch.key}
            draggable
            onDragStart={(e) => onDragStart(e, ch.key)}
            onDragOver={(e) => onDragOver(e, ch.key)}
            onDragLeave={() => setDragOver((k) => (k === ch.key ? null : k))}
            onDrop={(e) => onDrop(e, ch.key)}
            className={dragOver === ch.key ? 'border-t border-cs-accent' : undefined}
          >
            <SidebarMenuSubButton
              isActive={active}
              onClick={() => onSelect(ch.key)}
              onContextMenu={(e) => onContext(ch, e)}
              className={cn(ACTIVE_BUTTON_CLASS, !onDevice && 'opacity-50')}
              asChild
            >
              <button type="button" data-testid="channel-nav-item" data-channel-key={ch.key}>
                <Icon />
                <span className={cn('flex-1 truncate', !onDevice && 'italic')}>{ch.name}</span>
                <NavRowTrailing
                  unread={unread}
                  showUnread={showUnread}
                  muted={ch.muted}
                  pinned={pinSet.has(ch.key)}
                  pinTestId="channel-pin-indicator"
                />
              </button>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        );
      })}
      {hidden > 0 && <ShowMoreRow count={hidden} onClick={onShowMore} />}
    </SidebarMenuSub>
  );
}
