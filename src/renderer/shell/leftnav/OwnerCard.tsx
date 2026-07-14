import { Copy, Radio } from 'lucide-react';
import type { Owner } from '../../../shared/types';
import { CopyButton } from '../../components/CopyButton';
import { PathHashBadge } from '../../components/PathHashBadge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../components/ui/hover-card';
import { SidebarMenu, SidebarMenuItem } from '../../components/ui/sidebar';
import { Identicon } from '../../features/quick-actions/Identicon';
import { QuickActions } from '../../features/quick-actions/QuickActions';
import type { ApiClient } from '../../lib/api';
import { formatVoltage, lipoPercent } from '../../lib/battery';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { OwnerCardPopover } from './OwnerCardPopover';

/** Header identity card — identicon, name, battery, instrument rail, and the
 *  user's configured quick actions. Hovering the header reveals full radio detail. */
export function OwnerCard({ owner, client }: { owner: Owner | null; client: ApiClient | null }) {
  const deviceInfo = useStore((s) => s.deviceInfo);
  const radio = useStore((s) => s.radioSettings);
  const transport = useStore((s) => s.transportState);
  const pathHashMode = radio.pathHashMode;
  const connected = transport === 'connected';

  const battMv = deviceInfo.batteryMv;
  const battPct = lipoPercent(battMv);
  const battText = battMv > 0 ? `${formatVoltage(battMv)}${battPct !== null ? ` · ${battPct}%` : ''}` : '—';

  return (
    <SidebarMenu>
      <SidebarMenuItem className="p-1 group-data-[collapsible=icon]:p-0">
        <HoverCard openDelay={200} closeDelay={120}>
          <div className="flex flex-col gap-2">
            {/* Hovering this top row reveals the full radio details. */}
            <HoverCardTrigger asChild>
              <div className="flex items-center gap-2">
                {owner ? (
                  <Identicon hex={owner.publicKeyHex} size={32} />
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cs-border bg-cs-bg-3 text-cs-text-dim">
                    <Radio className="size-4" aria-hidden />
                  </div>
                )}
                <div className="grid min-w-0 flex-1 leading-tight group-data-[collapsible=icon]:hidden">
                  <span data-testid="owner-name" className="truncate text-sm font-medium text-cs-text">
                    {owner?.name ?? (connected ? 'No identity' : 'Not connected')}
                  </span>
                  {owner ? (
                    <div className="flex w-fit items-center gap-1.5">
                      <CopyButton
                        value={owner.publicKeyHex}
                        title="Copy full public key"
                        className="flex items-center gap-1 rounded font-mono text-[10px] tracking-wide text-cs-text-dim hover:text-cs-text"
                      >
                        <span className="truncate">{owner.publicKeyHex.slice(0, 6)}</span>
                        <Copy aria-hidden="true" className="size-2.5 shrink-0" />
                      </CopyButton>
                      <PathHashBadge bytes={pathHashMode} />
                    </div>
                  ) : (
                    <span className="truncate font-mono text-[10px] tracking-wide text-cs-text-dim">
                      {connected ? 'configure to send adverts' : 'Connect a radio'}
                    </span>
                  )}
                </div>
              </div>
            </HoverCardTrigger>

            {/* Detail block — hidden when the sidebar is icon-collapsed */}
            <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
              {/* Battery — grays out and prompts to connect when offline */}
              <div className={cn('transition-opacity', !connected && 'opacity-50')}>
                {connected ? (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-cs-text-dim">Battery</span>
                    <span className="font-mono tabular-nums text-cs-text-muted">{battText}</span>
                  </div>
                ) : (
                  <div className="text-[10px] text-cs-text-dim">Connect to show battery</div>
                )}
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-cs-bg-3">
                  <div
                    className="h-full bg-cs-accent transition-[width] duration-300"
                    style={{ width: `${connected ? (battPct ?? 0) : 0}%` }}
                  />
                </div>
              </div>

              {/* Configurable quick actions */}
              <QuickActions owner={owner} client={client} />
            </div>
          </div>
          <HoverCardContent align="start" side="right" sideOffset={8} className="w-72 p-3">
            <OwnerCardPopover />
          </HoverCardContent>
        </HoverCard>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
