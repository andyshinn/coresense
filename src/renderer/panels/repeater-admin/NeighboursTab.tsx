import { useState } from 'react';
import type { Contact, RepeaterNeighboursPage } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

// orderBy byte matches firmware MyMeshRepeater.cpp:289 — 0=newest, 1=oldest,
// 2=strongest SNR, 3=weakest.
const ORDER_LABELS: Record<number, string> = {
  0: 'Newest first',
  1: 'Oldest first',
  2: 'Strongest SNR',
  3: 'Weakest SNR',
};

export function NeighboursTab({ contact, client }: Props) {
  const [page, setPage] = useState<RepeaterNeighboursPage | null>(null);
  const [orderBy, setOrderBy] = useState(2);
  const [count, setCount] = useState(16);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const res = await api.repeaterNeighbours(client, contact.key, {
        count,
        orderBy,
        prefixLen: 6,
      });
      setPage(res.page);
    } catch (err) {
      notify.error(`Neighbours fetch failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-cs-text-muted">
          Order
          <select
            value={orderBy}
            onChange={(e) => setOrderBy(Number(e.target.value))}
            className="rounded border border-cs-border bg-cs-bg-2 px-2 py-1 font-mono text-[12px] text-cs-text"
          >
            {Object.entries(ORDER_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-cs-text-muted">
          Count
          <input
            type="number"
            min={1}
            max={64}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 16)}
            className="w-20 rounded border border-cs-border bg-cs-bg-2 px-2 py-1 font-mono text-[12px] text-cs-text"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={!client || busy}
          className="rounded border border-cs-border bg-cs-bg-3 px-2 py-1 text-[12px] text-cs-text-muted hover:bg-cs-accent-soft/30 hover:text-cs-text disabled:opacity-50"
        >
          {busy ? 'Fetching…' : 'Fetch neighbours'}
        </button>
      </div>

      {page && (
        <p className="text-[11px] text-cs-text-dim">
          {page.neighbours.length} of {page.total} neighbours
        </p>
      )}

      {page && page.neighbours.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-cs-border text-[10px] uppercase text-cs-text-muted">
              <th className="py-1 text-left font-medium">Pubkey prefix</th>
              <th className="py-1 text-right font-medium">Heard</th>
              <th className="py-1 text-right font-medium">SNR</th>
            </tr>
          </thead>
          <tbody>
            {page.neighbours.map((n) => (
              <tr key={n.pubKeyPrefixHex} className="border-b border-cs-border/40">
                <td className="py-0.5 font-mono text-cs-text">{n.pubKeyPrefixHex}</td>
                <td className="py-0.5 text-right font-mono text-cs-text-muted">
                  {fmtSecsAgo(n.heardSecsAgo)}
                </td>
                <td className="py-0.5 text-right font-mono text-cs-text">
                  {n.snrDb.toFixed(1)} dB
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function fmtSecsAgo(s: number): string {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
