import { useState } from 'react';
import type { Contact, RepeaterAclEntry } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';

interface Props {
  contact: Contact;
  client: ApiClient | null;
  disabled: boolean;
}

export function AclTab({ contact, client, disabled }: Props) {
  const [entries, setEntries] = useState<RepeaterAclEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const res = await api.repeaterAcl(client, contact.key);
      setEntries(res.entries);
    } catch (err) {
      notify.error(`ACL fetch failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  if (disabled) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[12px] text-cs-text-dim">
        Admin login required to view the ACL.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">
          Access control list
        </h3>
        <button
          type="button"
          onClick={load}
          disabled={!client || busy}
          className="rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:opacity-50"
        >
          {busy ? 'Fetching…' : 'Refresh ACL'}
        </button>
      </div>

      {entries === null && (
        <p className="text-[12px] text-cs-text-dim">
          Press <em>Refresh ACL</em> to fetch the current allow-list. Use the CLI tab to run
          <code className="mx-1 rounded bg-cs-bg-3 px-1 font-mono text-[11px]">setperm</code>
          against an entry.
        </p>
      )}

      {entries && entries.length === 0 && (
        <p className="text-[12px] text-cs-text-dim">ACL is empty.</p>
      )}

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
                <td className="py-0.5 font-mono text-cs-text">
                  0x{e.permissions.toString(16).padStart(2, '0')}
                </td>
                <td className="py-0.5 text-cs-text-muted">
                  {e.isAdmin ? 'admin' : e.isGuest ? 'guest' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
