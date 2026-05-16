import { useState } from 'react';
import type { Contact } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

export function StatusTab({ contact, client }: Props) {
  const status = useStore((s) => s.repeaterStatusByKey[contact.key]);
  const [busy, setBusy] = useState(false);

  const onRefresh = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      await api.repeaterStatus(client, contact.key);
      notify.success('Status requested');
    } catch (err) {
      notify.error(`Status request failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">
          Repeater status
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!client || busy}
          className="rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[11px] text-cs-text-muted hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:opacity-50"
        >
          {busy ? 'Requesting…' : 'Request status'}
        </button>
      </div>

      {!status && (
        <p className="text-[12px] text-cs-text-dim">
          No snapshot yet. Press <em>Request status</em> — the mesh round-trip usually takes a few
          seconds.
        </p>
      )}

      {status && (
        <section className="rounded border border-cs-border bg-cs-bg-2 p-3 text-[12px]">
          <header className="mb-2 flex items-baseline justify-between">
            <span className="font-mono text-[10px] text-cs-text-dim">
              received {new Date(status.receivedAt).toLocaleString()}
            </span>
          </header>
          {status.fields.length === 0 ? (
            <pre className="font-mono text-[10px] text-cs-text-dim">
              {status.payloadHex || '(empty)'}
            </pre>
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
            <pre className="mt-1 break-all font-mono text-[10px] text-cs-text-dim">
              {status.payloadHex}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}
