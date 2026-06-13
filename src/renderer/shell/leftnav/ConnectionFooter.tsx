import { Bluetooth, RotateCw } from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import type { SyncProgress, TransportState } from '../../../shared/types';
import { Progress } from '../../components/ui/progress';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '../../components/ui/sidebar';
import { type ApiClient, api } from '../../lib/api';
import { loadLastDevice } from '../../lib/lastDevice';
import { notify } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { ACTIVE_BUTTON_CLASS } from './atoms';

const TRANSPORT_LABEL: Record<TransportState, string> = {
  idle: 'Not connected',
  scanning: 'Scanning',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Error',
};

const TRANSPORT_DOT: Record<TransportState, string> = {
  idle: 'bg-cs-text-dim',
  scanning: 'bg-cs-warn animate-pulse',
  connecting: 'bg-cs-accent animate-pulse',
  connected: 'bg-cs-online',
  error: 'bg-cs-danger',
};

// After the handshake completes we briefly keep the 100% progress bar visible
// so the user can register the jump to "Connected", then fade it out. Keep
// this short enough that it doesn't linger but long enough to be perceptible.
const SYNC_DONE_FADE_MS = 800;

/** Sidebar footer row showing transport state, sync progress, and a reconnect-to-last-device shortcut. */
export function ConnectionFooter({
  client,
  state,
  sync,
  onClick,
  active,
}: {
  client: ApiClient | null;
  state: TransportState;
  sync: SyncProgress;
  onClick: () => void;
  active: boolean;
}) {
  const syncing = state === 'connected' && sync.phase === 'syncing';
  const justFinished = state === 'connected' && sync.phase === 'done';
  const [reconnecting, setReconnecting] = useState(false);
  const lastDevice = loadLastDevice();
  const canReconnect = !!client && !!lastDevice && (state === 'idle' || state === 'error') && !reconnecting;

  const handleReconnect = useCallback(
    async (e: MouseEvent) => {
      e.stopPropagation();
      if (!client || !lastDevice) return;
      setReconnecting(true);
      try {
        await api.connect(client, lastDevice.id);
      } catch (err) {
        notify.error(`Reconnect failed: ${(err as Error).message}`, err);
      } finally {
        setReconnecting(false);
      }
    },
    [client, lastDevice],
  );
  const [showFinishedBar, setShowFinishedBar] = useState(false);
  useEffect(() => {
    if (!justFinished) {
      setShowFinishedBar(false);
      return;
    }
    setShowFinishedBar(true);
    const t = setTimeout(() => setShowFinishedBar(false), SYNC_DONE_FADE_MS);
    return () => clearTimeout(t);
  }, [justFinished]);

  const showProgress = syncing || showFinishedBar;
  const dotClass = syncing ? TRANSPORT_DOT.scanning : TRANSPORT_DOT[state];
  const done = sync.channels.done + sync.contacts.done;
  const total = sync.channels.total + sync.contacts.total;
  const pct = syncing && total > 0 ? Math.round((done / total) * 100) : 100;
  const label = syncing ? 'Syncing' : TRANSPORT_LABEL[state];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          data-testid="connection-status-footer"
          tooltip={label}
          isActive={active}
          onClick={onClick}
          className={cn(ACTIVE_BUTTON_CLASS, 'h-auto flex-col items-stretch gap-1.5 group-data-[collapsible=icon]:flex-row')}
        >
          <span className="flex w-full items-center gap-2">
            <Bluetooth aria-hidden="true" className="shrink-0 group-data-[collapsible=icon]:hidden" />
            {/* In icon mode this dot is the only visible element. Bumping it
                from size-2 to size-2.5 there gives a more legible target inside
                the 32px icon button. */}
            <span className={cn('size-2 shrink-0 rounded-full group-data-[collapsible=icon]:size-2.5', dotClass)} />
            <span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">{label}</span>
            {syncing && (
              <span className="tabular-nums text-[10px] text-cs-text-dim group-data-[collapsible=icon]:hidden">
                {done}/{total}
              </span>
            )}
          </span>
          {showProgress && (
            <Progress
              value={pct}
              aria-label="Sync progress"
              className={cn(
                'h-1 bg-cs-warn/20 transition-opacity duration-500 *:data-[slot=progress-indicator]:bg-cs-warn',
                syncing ? 'opacity-100' : 'opacity-0',
              )}
            />
          )}
        </SidebarMenuButton>
        {canReconnect && (
          <button
            type="button"
            onClick={handleReconnect}
            title={`Reconnect to ${lastDevice?.name ?? 'last radio'}`}
            aria-label={`Reconnect to ${lastDevice?.name ?? 'last radio'}`}
            className="absolute right-1 top-1/2 flex aspect-square size-7 -translate-y-1/2 items-center justify-center rounded-md text-cs-text-muted transition-colors hover:bg-cs-bg-3 hover:text-cs-text group-data-[collapsible=icon]:hidden"
          >
            <RotateCw aria-hidden="true" className="size-4" />
          </button>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
