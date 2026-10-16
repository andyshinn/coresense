import { useState } from 'react';
import type { BlockRule, BlockRuleType } from '../../shared/types';
import { api } from '../lib/api';
import { useApiClient } from '../lib/apiClientContext';
import { notify } from '../lib/notify';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const WINDOW_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { label: 'All time', ms: 0 },
];

/** Pre-fill payload from a message that the user right-clicked. Pass empty
 *  strings/undefined for fields we don't have. */
export interface BlockSenderDialogPrefill {
  pubkey?: string;
  pubkeyPrefix?: string;
  name?: string;
}

interface Props {
  open: boolean;
  prefill: BlockSenderDialogPrefill;
  onClose: () => void;
}

type IdentifierType = Exclude<BlockRuleType, 'nameRegex'>;

/** The exact-match identifiers a prefill can carry, in rule order. Each type
 *  doubles as its prefill field. The regex row has its own shape (an editable
 *  pattern), so it stays separate. */
const IDENTIFIERS: Array<{ type: IdentifierType; label: string }> = [
  { type: 'pubkey', label: 'Public key' },
  { type: 'pubkeyPrefix', label: 'Key prefix' },
  { type: 'name', label: 'Name' },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function BlockSenderDialog({ open, prefill, onClose }: Props) {
  const client = useApiClient();
  const [checked, setChecked] = useState<Record<IdentifierType, boolean>>(() => ({
    pubkey: prefill.pubkey != null,
    pubkeyPrefix: prefill.pubkeyPrefix != null,
    name: prefill.name != null,
  }));
  const [regexChecked, setRegexChecked] = useState(false);
  const [regexSource, setRegexSource] = useState(prefill.name ? `^${escapeRegex(prefill.name)}$` : '');
  const [retroChecked, setRetroChecked] = useState(true);
  const [windowMs, setWindowMs] = useState<number>(WINDOW_OPTIONS[1].ms);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const regexValid = (() => {
    if (!regexChecked) return true;
    try {
      new RegExp(regexSource, 'i');
      return true;
    } catch {
      return false;
    }
  })();
  const anyChecked = IDENTIFIERS.some(({ type }) => checked[type]) || regexChecked;
  const submitDisabled = !anyChecked || !regexValid || submitting || client == null;

  async function submit() {
    if (client == null) return;
    setSubmitting(true);
    const now = Date.now();
    const tsFrom = retroChecked ? (windowMs === 0 ? 0 : now - windowMs) : now;

    const rule = (type: BlockRuleType, pattern: string): Omit<BlockRule, 'id' | 'createdAt' | 'matchCount'> => ({
      type,
      pattern,
      tsFrom,
      enabled: true,
      note: note || undefined,
    });
    const rules = IDENTIFIERS.flatMap(({ type }) => {
      const pattern = prefill[type];
      return checked[type] && pattern ? [rule(type, pattern)] : [];
    });
    if (regexChecked && regexSource.length > 0) rules.push(rule('nameRegex', regexSource));

    try {
      await api.addBlockRules(client, rules);
      notify.success(`Added ${rules.length} block rule${rules.length === 1 ? '' : 's'}`);
      onClose();
    } catch (err) {
      notify.failure('Block', err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block sender</DialogTitle>
          <DialogDescription>Create block rule(s) for this sender.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-2">
            <Label className="text-xs uppercase text-cs-text-dim">Identifiers from this message</Label>
            {IDENTIFIERS.map(({ type, label }) => (
              <div key={type} className="flex items-center gap-2">
                <Checkbox
                  checked={checked[type]}
                  disabled={prefill[type] == null}
                  onCheckedChange={(v) => setChecked((c) => ({ ...c, [type]: v === true }))}
                />
                <span className="flex-1">{label}</span>
                <code className="text-xs">{prefill[type] ?? '—'}</code>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Checkbox checked={regexChecked} onCheckedChange={(v) => setRegexChecked(v === true)} />
              <span className="w-24">Name regex</span>
              <Input
                value={regexSource}
                onChange={(e) => setRegexSource(e.target.value)}
                className="flex-1"
                placeholder="^Bob.*$"
              />
            </div>
            {regexChecked && !regexValid && <p className="text-xs text-cs-danger">Invalid regex</p>}
          </div>

          <div className="space-y-2 border-t pt-2">
            <div className="flex items-center gap-2">
              <Checkbox checked={retroChecked} onCheckedChange={(v) => setRetroChecked(v === true)} />
              <span className="flex-1">Also hide past messages from last</span>
              <Select value={String(windowMs)} onValueChange={(v) => setWindowMs(Number(v))} disabled={!retroChecked}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((o) => (
                    <SelectItem key={o.ms} value={String(o.ms)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="block-note" className="text-xs uppercase text-cs-text-dim">
              Note (optional)
            </Label>
            <Input id="block-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitDisabled}>
            Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
