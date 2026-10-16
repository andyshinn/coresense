import type { Contact } from '../../../shared/types';
import { RelativeTime } from '../../components/RelativeTime';
import { useBusyAction } from '../../hooks/useBusyAction';
import { api } from '../../lib/api';
import { useApiClient } from '../../lib/apiClientContext';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { TabToolbar } from './TabToolbar';

interface Props {
  contact: Contact;
}

export function StatusTab({ contact }: Props) {
  const client = useApiClient();
  const status = useStore((s) => s.repeaterStatusByKey[contact.key]);
  const [onRefresh, busy] = useBusyAction(async () => {
    if (!client) return;
    await api.repeaterStatus(client, contact.key);
    notify.success('Status requested');
  }, 'Status request');

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <TabToolbar
        title="Repeater status"
        label="Request status"
        busyLabel="Requesting…"
        busy={busy}
        disabled={!client}
        onClick={onRefresh}
      />

      {!status && (
        <p className="text-[12px] text-cs-text-dim">
          No snapshot yet. Press <em>Request status</em> — the mesh round-trip usually takes a few seconds.
        </p>
      )}

      {status && (
        <section className="rounded border border-cs-border bg-cs-bg-2 p-3 text-[12px]">
          <header className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[10px] text-cs-text-dim">
              received <RelativeTime ts={status.receivedAt} />
            </span>
          </header>
          {status.fields.length === 0 ? (
            <pre className="font-mono text-[10px] text-cs-text-dim">{status.payloadHex || '(empty)'}</pre>
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
              {status.fields.map((f) => (
                <div key={f.name} className="contents">
                  <dt className="text-cs-text-muted">{f.name}</dt>
                  <dd className="font-mono text-cs-text">
                    {f.value}
                    {f.unit ? ` ${f.unit}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-[10px] text-cs-text-dim">raw payload</summary>
            <pre className="mt-1 break-all font-mono text-[10px] text-cs-text-dim">{status.payloadHex}</pre>
          </details>
        </section>
      )}
    </div>
  );
}
