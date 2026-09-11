import { RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { useContactRefresh } from '../../hooks/useContactRefresh';
import type { ApiClient } from '../../lib/api';
import { deriveContactView } from '../../lib/contactManagerView';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { CapacityMeter } from './CapacityMeter';
import { ListRow, SelectAllBar, TableView } from './ContactRows';
import { Toolbar } from './Toolbar';

/** Re-read the radio's contact store on demand — the user's lever for "the
 *  radio knows someone the app doesn't" short of a reconnect (#45 item 6). */
function RefreshButton({ client }: { client: ApiClient | null }) {
  const { refreshing, refresh } = useContactRefresh(client);
  return (
    <button
      type="button"
      onClick={refresh}
      disabled={!client || refreshing}
      title="Re-read the contact list from the radio"
      aria-label="Refresh contacts from radio"
      className="grid size-7 place-items-center rounded-md border border-cs-border text-cs-text-muted hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
    </button>
  );
}

export function ContactManager({ client }: { client: ApiClient | null }) {
  const discovered = useStore((s) => s.discovered);
  const cm = useStore((s) => s.contactManager);
  const view = useMemo(() => deriveContactView(discovered, cm, Date.now()), [discovered, cm]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-cs-border bg-cs-bg-2 px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-cs-text">Contacts</h1>
          <p className="font-mono text-[10px] text-cs-text-dim">discovered node adverts</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <RefreshButton client={client} />
          <CapacityMeter />
        </div>
      </header>
      <Toolbar counts={view.counts} />
      <SelectAllBar rows={view.rows} />
      <div className="flex-1 overflow-y-auto">
        {view.rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-cs-text-dim">No contacts match these filters.</div>
        ) : cm.layout === 'table' ? (
          <TableView rows={view.rows} client={client} />
        ) : (
          <div>
            {view.rows.map((c) => (
              <ListRow key={c.publicKeyHex} c={c} client={client} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
