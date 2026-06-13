import { useState } from 'react';
import type { Contact, RepeaterOwnerInfo } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

export function OwnerTab({ contact, client }: Props) {
  const [info, setInfo] = useState<RepeaterOwnerInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const res = await api.repeaterOwner(client, contact.key);
      setInfo(res.info);
    } catch (err) {
      notify.error(`Owner info fetch failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">Owner info</h3>
        <button
          type="button"
          onClick={load}
          disabled={!client || busy}
          className="rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:opacity-50"
        >
          {busy ? 'Fetching…' : 'Fetch'}
        </button>
      </div>

      {info && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          <dt className="text-cs-text-muted">Firmware</dt>
          <dd className="font-mono text-cs-text">{info.firmwareVersion || '—'}</dd>
          <dt className="text-cs-text-muted">Node name</dt>
          <dd className="font-mono text-cs-text">{info.nodeName || '—'}</dd>
          <dt className="text-cs-text-muted">Owner</dt>
          <dd className="whitespace-pre-wrap text-cs-text">{info.ownerInfo || '—'}</dd>
        </dl>
      )}
    </div>
  );
}
