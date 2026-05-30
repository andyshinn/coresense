import { useMemo } from 'react';
import type { ApiClient } from '../../lib/api';
import { deriveContactView } from '../../lib/contactManagerView';
import { useStore } from '../../lib/store';
import { CapacityMeter } from './CapacityMeter';
import { ListRow, SelectAllBar, TableView } from './ContactRows';
import { Toolbar } from './Toolbar';

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
        <div className="ml-auto">
          <CapacityMeter />
        </div>
      </header>
      <Toolbar counts={view.counts} />
      <SelectAllBar rows={view.rows} />
      <div className="flex-1 overflow-y-auto">
        {view.rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-cs-text-dim">
            No contacts match these filters.
          </div>
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
