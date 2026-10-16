import { useState } from 'react';
import type { Contact, RepeaterOwnerInfo } from '../../../shared/types';
import { useBusyAction } from '../../hooks/useBusyAction';
import { api } from '../../lib/api';
import { useApiClient } from '../../lib/apiClientContext';
import { TabToolbar } from './TabToolbar';

interface Props {
  contact: Contact;
}

export function OwnerTab({ contact }: Props) {
  const client = useApiClient();
  const [info, setInfo] = useState<RepeaterOwnerInfo | null>(null);
  const [load, busy] = useBusyAction(async () => {
    if (!client) return;
    const res = await api.repeaterOwner(client, contact.key);
    setInfo(res.info);
  }, 'Owner info fetch');

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <TabToolbar title="Owner info" label="Fetch" busyLabel="Fetching…" busy={busy} disabled={!client} onClick={load} />

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
