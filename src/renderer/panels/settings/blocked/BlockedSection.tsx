import { Plus, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { BlockRule } from '../../../../shared/types';
import { BlockSenderDialog } from '../../../components/BlockSenderDialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { type ApiClient, api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { fmtDateTime } from '../../../lib/time';

interface Props {
  client: ApiClient | null;
}

function ruleTypeLabel(t: BlockRule['type']): string {
  switch (t) {
    case 'pubkey':
      return 'pubkey';
    case 'pubkeyPrefix':
      return 'prefix';
    case 'name':
      return 'name';
    case 'nameRegex':
      return 'regex';
  }
}

function shortPattern(r: BlockRule): string {
  if (r.type === 'pubkey' && r.pattern.length > 12) {
    return `${r.pattern.slice(0, 8)}…${r.pattern.slice(-4)}`;
  }
  return r.pattern;
}

export function BlockedSection({ client }: Props) {
  const rules = useStore((s) => s.blockRules);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  const [filter, setFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const filtered =
    filter.trim().length === 0
      ? rules
      : rules.filter((r) => r.pattern.includes(filter) || (r.note ?? '').includes(filter));

  const sorted = filtered.slice().sort((a, b) => b.createdAt - a.createdAt);

  async function toggleEnabled(r: BlockRule) {
    if (!client) return;
    try {
      await api.updateBlockRule(client, r.id, { enabled: !r.enabled });
    } catch (err) {
      notify.error(`Toggle failed: ${(err as Error).message}`, err);
    }
  }
  async function remove(r: BlockRule) {
    if (!client) return;
    try {
      await api.removeBlockRule(client, r.id);
      notify.success('Unblocked');
    } catch (err) {
      notify.error(`Remove failed: ${(err as Error).message}`, err);
    }
  }

  return (
    <section id="blocked-rules" data-section="blocked-rules" className="space-y-3 pt-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium">Blocked senders</h3>
          <p className="text-sm text-cs-text-muted">
            Hide messages matching these rules everywhere.
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add rule
        </Button>
      </header>

      <Input
        placeholder="Filter by pattern or note…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm"
      />

      {sorted.length === 0 ? (
        <p className="text-sm text-cs-text-dim">
          No block rules yet. Right-click any message and choose <em>Block sender…</em>, or click{' '}
          <em>Add rule</em>.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-cs-text-dim">
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Pattern</th>
              <th className="py-1 pr-2">Since</th>
              <th className="py-1 pr-2">Matches</th>
              <th className="py-1 pr-2">Note</th>
              <th className="w-32 py-1 pr-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className={r.enabled ? '' : 'opacity-50'}>
                <td className="py-1 pr-2">{ruleTypeLabel(r.type)}</td>
                <td className="py-1 pr-2 font-mono">{shortPattern(r)}</td>
                <td className="py-1 pr-2">
                  {r.tsFrom === 0 ? 'all' : fmtDateTime(r.tsFrom, timeFormat)}
                </td>
                <td className="py-1 pr-2 tabular-nums">{r.matchCount}</td>
                <td className="py-1 pr-2">{r.note ?? ''}</td>
                <td className="py-1 pr-2">
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toggleEnabled(r)}
                      title={r.enabled ? 'Disable' : 'Enable'}
                    >
                      {r.enabled ? (
                        <ToggleRight className="h-4 w-4" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r)} title="Unblock">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <BlockSenderDialog client={client} open prefill={{}} onClose={() => setShowAdd(false)} />
      )}
    </section>
  );
}
