import { useState } from 'react';
import type { Contact, RepeaterAclEntry } from '../../../shared/types';
import { useBusyAction } from '../../hooks/useBusyAction';
import { api } from '../../lib/api';
import { useApiClient } from '../../lib/apiClientContext';
import { RADIO_BUSY_HINT, useRadioBusy } from '../../lib/telemetry';
import { ACL_ROLE_LABEL, formatPermissions } from './aclRole';
import { TabToolbar } from './TabToolbar';

interface Props {
  contact: Contact;
  disabled: boolean;
}

export function AclTab({ contact, disabled }: Props) {
  const client = useApiClient();
  const [entries, setEntries] = useState<RepeaterAclEntry[] | null>(null);
  // A telemetry request holds the radio; a fetch now would kill its reply.
  const radioBusy = useRadioBusy();
  const [load, busy] = useBusyAction(async () => {
    if (!client || radioBusy) return;
    const res = await api.repeaterAcl(client, contact.key);
    setEntries(res.entries);
  }, 'ACL fetch');

  if (disabled) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[12px] text-cs-text-dim">
        Admin login required to view the ACL.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <TabToolbar
        title="Access control list"
        label="Refresh ACL"
        busyLabel="Fetching…"
        busy={busy}
        disabled={!client || radioBusy}
        hint={radioBusy ? RADIO_BUSY_HINT : undefined}
        onClick={load}
      />

      {entries === null && (
        <p className="text-[12px] text-cs-text-dim">
          Press <em>Refresh ACL</em> to fetch the current allow-list. Use the CLI tab to run
          <code className="mx-1 rounded bg-cs-bg-3 px-1 font-mono text-[11px]">setperm</code>
          against an entry.
        </p>
      )}

      {entries && entries.length === 0 && <p className="text-[12px] text-cs-text-dim">ACL is empty.</p>}

      {entries && entries.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-cs-border text-[10px] uppercase text-cs-text-muted">
              <th className="py-1 text-left font-medium">Pubkey prefix</th>
              <th className="py-1 text-left font-medium">Permissions</th>
              <th className="py-1 text-left font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.pubKeyPrefixHex} className="border-b border-cs-border/40">
                <td className="py-0.5 font-mono text-cs-text">{e.pubKeyPrefixHex}</td>
                <td className="py-0.5 font-mono text-cs-text">{formatPermissions(e.permissions)}</td>
                <td className="py-0.5 text-cs-text-muted">{ACL_ROLE_LABEL[e.role]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
