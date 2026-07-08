import { UserX } from 'lucide-react';
import type { Channel, ChannelStats, Contact } from '../../../../shared/types';
import { ColoredUsername } from '../../../components/ColoredUsername';
import { RelativeTime } from '../../../components/RelativeTime';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../../components/ui/hover-card';
import { useChannelStats } from '../../../hooks/useChannelStats';
import type { ApiClient } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { Placeholder } from '../atoms';

/** Resolve a channel roster entry to a navigable contact route key, or null
 *  when it can't open a contact page. Channel posts carry only a "name:" prefix
 *  on the wire (no pubkey), so we match the poster's display name against saved
 *  contacts — the same resolution @mention pills use. */
export function contactKeyForSender(fromPk: string | null, contacts: Contact[]): string | null {
  if (!fromPk || fromPk === 'unknown') return null;
  if (fromPk.startsWith('name:')) {
    const name = fromPk.slice(5);
    return contacts.find((c) => c.name === name)?.key ?? null;
  }
  return `c:${fromPk}`; // a raw pubkey — not currently produced for channel posts
}

/** Display name of a named channel poster (`name:<n>`), else null (self/unknown). */
function posterName(fromPk: string | null): string | null {
  return fromPk?.startsWith('name:') ? fromPk.slice(5) : null;
}

export function ChannelPeopleBody({
  stats,
  loading,
  resolveContactKey,
  onSelectContact,
}: {
  stats: ChannelStats | null;
  loading: boolean;
  resolveContactKey?: (fromPk: string | null) => string | null;
  onSelectContact?: (contactKey: string) => void;
}) {
  if (!stats) return <Placeholder label={loading ? 'loading…' : 'nobody seen yet'} />;
  const noun = stats.distinctSenders === 1 ? 'person' : 'people';
  return (
    <div className="flex flex-col gap-2 text-cs-text-muted">
      <div className="text-[11px] text-cs-text-dim">{`${stats.distinctSenders} ${noun} seen`}</div>
      <div>
        {stats.roster.map((r) => {
          const key = resolveContactKey?.(r.fromPk) ?? null;
          const name = posterName(r.fromPk);
          // A named poster we don't have saved: can't open a contact page.
          const missingContact = key == null && name != null;
          return (
            <div key={r.fromPk ?? 'self'} className="flex items-center justify-between gap-2 py-1">
              {key && onSelectContact ? (
                <ColoredUsername
                  sender={r.fromPk ?? undefined}
                  size="sm"
                  onClick={() => onSelectContact(key)}
                  className="cursor-pointer hover:underline"
                />
              ) : missingContact ? (
                <HoverCard openDelay={150} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <span className="inline-flex min-w-0 cursor-help items-center gap-1">
                      <ColoredUsername sender={r.fromPk ?? undefined} size="sm" />
                      <UserX aria-hidden className="size-3 shrink-0 text-cs-text-dim" />
                    </span>
                  </HoverCardTrigger>
                  <HoverCardContent
                    side="left"
                    align="center"
                    sideOffset={8}
                    collisionPadding={8}
                    className="w-auto max-w-64 p-3"
                  >
                    <div className="flex items-start gap-2">
                      <UserX aria-hidden className="mt-0.5 size-4 shrink-0 text-cs-text-dim" />
                      <div className="text-xs">
                        <div className="font-medium text-cs-text">No saved contact</div>
                        <p className="text-cs-text-dim">{name} contact is missing.</p>
                      </div>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              ) : (
                <ColoredUsername sender={r.fromPk ?? undefined} size="sm" />
              )}
              <span className="flex shrink-0 items-center gap-2 text-[10px]">
                <span className="tabular-nums text-cs-text-muted">{r.count}</span>
                <span className="text-cs-text-dim">
                  <RelativeTime ts={r.lastTs} />
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChannelPeopleSection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats, loading } = useChannelStats(channel.key, client);
  const contacts = useStore((s) => s.contacts);
  const setActiveKey = useStore((s) => s.setActiveKey);
  return (
    <ChannelPeopleBody
      stats={stats}
      loading={loading}
      resolveContactKey={(fromPk) => contactKeyForSender(fromPk, contacts)}
      onSelectContact={setActiveKey}
    />
  );
}
