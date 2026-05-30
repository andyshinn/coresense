import {
  Ban,
  ChevronLeft,
  Download,
  type LucideIcon,
  Minus,
  Plus,
  Settings,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { BlockSenderDialog } from '../../../components/BlockSenderDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { type ApiClient, api } from '../../../lib/api';
import { deriveContactView } from '../../../lib/contactManagerView';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { ContactDetail } from './ContactDetail';

type Tone = 'danger' | 'accent' | undefined;

function RailActionButton({
  icon: Icon,
  label,
  sub,
  onClick,
  tone,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  onClick: () => void;
  tone?: Tone;
  disabled?: boolean;
}) {
  const iconTone =
    tone === 'danger'
      ? 'text-cs-danger'
      : tone === 'accent'
        ? 'text-cs-accent'
        : 'text-cs-text-muted';
  const labelTone = tone === 'danger' ? 'text-cs-danger' : 'text-cs-text';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-md border border-cs-border bg-cs-bg-2 px-2.5 py-2 text-xs hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className={`size-4 shrink-0 ${iconTone}`} />
      <span className="flex min-w-0 flex-col text-left">
        <span className={labelTone}>{label}</span>
        {sub ? <span className="font-mono text-[9.5px] text-cs-text-dim">{sub}</span> : null}
      </span>
    </button>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">
      {children}
    </div>
  );
}

function BulkActions({ client }: { client: ApiClient | null }) {
  const selected = useStore((s) => s.contactManager.selected);
  const clearCmSelected = useStore((s) => s.clearCmSelected);
  const n = selected.length;

  async function run(fn: () => Promise<void>, successMsg: string) {
    if (!client) return;
    try {
      await fn();
      clearCmSelected();
      notify.success(successMsg);
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <SubHeader>Selection</SubHeader>
        <span className="font-mono text-[9.5px] text-cs-text-dim">{n} selected</span>
      </div>
      <div className="space-y-1.5">
        <RailActionButton
          icon={Plus}
          label="Add to radio"
          sub={`${n} contact${n === 1 ? '' : 's'}`}
          tone="accent"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                await Promise.all(selected.map((pk) => api.addToRadio(client, pk)));
              },
              `Added ${n} contact${n === 1 ? '' : 's'} to radio`,
            )
          }
        />
        <RailActionButton
          icon={Minus}
          label="Remove from radio"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                await Promise.all(selected.map((pk) => api.removeFromRadio(client, pk)));
              },
              `Removed ${n} contact${n === 1 ? '' : 's'} from radio`,
            )
          }
        />
        <RailActionButton
          icon={Star}
          label="Favourite"
          sub="never auto-pruned"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                await Promise.all(selected.map((pk) => api.setFavourite(client, pk, true)));
              },
              `Favourited ${n} contact${n === 1 ? '' : 's'}`,
            )
          }
        />
        <RailActionButton
          icon={Ban}
          label="Block selected"
          tone="danger"
          disabled={!client}
          onClick={() =>
            run(
              async () => {
                if (!client) return;
                const rules = selected.map((pk) => ({
                  type: 'pubkey' as const,
                  pattern: pk,
                  tsFrom: 0,
                  enabled: true,
                }));
                await api.addBlockRules(client, rules);
              },
              `Blocked ${n} contact${n === 1 ? '' : 's'}`,
            )
          }
        />
      </div>
      <button
        type="button"
        onClick={clearCmSelected}
        className="text-[11px] text-cs-text-dim hover:text-cs-text"
      >
        Clear selection
      </button>
    </div>
  );
}

const PRUNE_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '7 days', ms: 604_800_000 },
  { label: '1 month', ms: 2_592_000_000 },
  { label: '3 months', ms: 7_776_000_000 },
  { label: '6 months', ms: 15_552_000_000 },
];

function ListActions({ client }: { client: ApiClient | null }) {
  const discovered = useStore((s) => s.discovered);
  const cm = useStore((s) => s.contactManager);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const blockRulesCount = useStore((s) => s.blockRules.length);
  const [showClear, setShowClear] = useState(false);
  const [showBlock, setShowBlock] = useState(false);

  const view = deriveContactView(discovered, cm, Date.now());
  const rows = view.rows;
  const discoveredOnly = rows.filter((c) => !c.onRadio && !c.blocked);
  const onRadioRows = rows.filter((c) => c.onRadio);
  const clearCount = discovered.filter((d) => !d.onRadio).length;

  async function addAllFiltered() {
    if (!client) return;
    try {
      await Promise.all(discoveredOnly.map((c) => api.addToRadio(client, c.publicKeyHex)));
      notify.success(
        `Added ${discoveredOnly.length} contact${discoveredOnly.length === 1 ? '' : 's'} to radio`,
      );
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  async function removeAllFiltered() {
    if (!client) return;
    try {
      await Promise.all(onRadioRows.map((c) => api.removeFromRadio(client, c.publicKeyHex)));
      notify.success(
        `Removed ${onRadioRows.length} contact${onRadioRows.length === 1 ? '' : 's'} from radio`,
      );
    } catch (err) {
      notify.error(`Action failed: ${(err as Error).message}`, err);
    }
  }

  async function prune(thresholdMs: number, label: string) {
    if (!client) return;
    const now = Date.now();
    const stale = discovered.filter(
      (d) =>
        d.onRadio && !d.favourite && d.lastAdvertMs != null && now - d.lastAdvertMs > thresholdMs,
    );
    if (stale.length === 0) {
      notify.info(`No contacts older than ${label}`);
      return;
    }
    try {
      await Promise.all(stale.map((d) => api.removeFromRadio(client, d.publicKeyHex)));
      notify.success(
        `Pruned ${stale.length} contact${stale.length === 1 ? '' : 's'} older than ${label}`,
      );
    } catch (err) {
      notify.error(`Prune failed: ${(err as Error).message}`, err);
    }
  }

  async function clearDiscovered() {
    if (!client) return;
    try {
      await api.clearDiscovered(client);
      notify.success(`Cleared ${clearCount} discovered contact${clearCount === 1 ? '' : 's'}`);
    } catch (err) {
      notify.error(`Clear failed: ${(err as Error).message}`, err);
    } finally {
      setShowClear(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <SubHeader>Quick actions</SubHeader>
          <span className="font-mono text-[9.5px] text-cs-text-dim">
            FILTERED · {rows.length} shown
          </span>
        </div>
        <div className="space-y-1.5">
          <RailActionButton
            icon={Plus}
            label="Add all filtered"
            sub={`${discoveredOnly.length} → radio`}
            tone="accent"
            disabled={!client}
            onClick={addAllFiltered}
          />
          <RailActionButton
            icon={Minus}
            label="Remove all filtered"
            disabled={!client}
            onClick={removeAllFiltered}
          />
        </div>
      </div>

      <div className="space-y-2">
        <SubHeader>Prune older than</SubHeader>
        <div className="grid grid-cols-2 gap-1.5">
          {PRUNE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              disabled={!client}
              onClick={() => prune(opt.ms, opt.label)}
              className="flex items-center gap-1.5 rounded-md border border-cs-border px-2 py-2 text-[11.5px] hover:border-cs-warn hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-3.5 shrink-0 text-cs-text-muted" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-cs-border pt-3">
        <RailActionButton
          icon={Settings}
          label="Auto-Add settings"
          sub="who joins automatically"
          onClick={() => setActiveKey('tool:settings:radio')}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <RailActionButton
            icon={Upload}
            label="Import"
            onClick={() => notify.info('Import JSON — coming soon')}
          />
          <RailActionButton
            icon={Download}
            label="Export"
            onClick={() => notify.info('Export JSON — coming soon')}
          />
        </div>
        <RailActionButton
          icon={Trash2}
          label="Clear discovered list"
          sub="keeps on-radio contacts"
          tone="danger"
          disabled={!client}
          onClick={() => setShowClear(true)}
        />
      </div>

      <div className="border-t border-cs-border pt-3">
        <RailActionButton
          icon={Ban}
          label="Add block rule"
          sub={`${blockRulesCount} active`}
          tone="danger"
          disabled={!client}
          onClick={() => setShowBlock(true)}
        />
      </div>

      <Dialog open={showClear} onOpenChange={(open) => !open && setShowClear(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear discovered list</DialogTitle>
            <DialogDescription>
              Delete {clearCount} discovered-only contact{clearCount === 1 ? '' : 's'}? On-radio
              contacts are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setShowClear(false)}
              className="rounded-md border border-cs-border bg-cs-bg-2 px-3 py-1.5 text-xs hover:bg-cs-bg-3"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={clearDiscovered}
              className="rounded-md border border-cs-danger bg-cs-danger/10 px-3 py-1.5 text-xs text-cs-danger hover:bg-cs-danger/20"
            >
              Delete {clearCount}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showBlock && (
        <BlockSenderDialog client={client} open prefill={{}} onClose={() => setShowBlock(false)} />
      )}
    </div>
  );
}

/** Contextual right-rail body for the Contact Manager: bulk actions when rows
 *  are selected, the focused contact's detail when a single row is focused,
 *  otherwise list-wide actions. */
export function ContactManagerRailBody({ client }: { client: ApiClient | null }) {
  const selected = useStore((s) => s.contactManager.selected);
  const focusKey = useStore((s) => s.contactManager.focusKey);
  const setCmFocus = useStore((s) => s.setCmFocus);

  if (selected.length > 0) return <BulkActions client={client} />;
  if (focusKey) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setCmFocus(null)}
          className="flex items-center gap-1 text-[11px] text-cs-text-dim hover:text-cs-text"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Back to list actions
        </button>
        <ContactDetail publicKeyHex={focusKey} client={client} />
      </div>
    );
  }
  return <ListActions client={client} />;
}
