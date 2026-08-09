import { RotateCcw, TriangleAlert, X } from 'lucide-react';
import { CLI_BY_NAME, type CliCommand } from '../../../../shared/repeater-cli/catalog';
import type { RebootPending } from './lib/persistence';

// One shape: phase 1 owns the persisted RebootPending; this is just its alias.
export type RebootPendingState = RebootPending;

export const EMPTY_REBOOT: RebootPendingState = { settings: [], dismissed: false, rebootSentAtMs: null };

// Derive a settings entry from the command that armed it (§6): verify is the
// get-command sharing this key, else null; label is the name minus 'set '.
function deriveRebootEntry(cmd: CliCommand): { label: string; verify: string | null } {
  const label = cmd.name.startsWith('set ') ? cmd.name.slice(4) : cmd.name;
  let verify: string | null = null;
  if (cmd.key) {
    for (const c of Object.values(CLI_BY_NAME)) {
      if (c.key === cmd.key && c.name.startsWith('get ')) {
        verify = c.name;
        break;
      }
    }
  }
  return { label, verify };
}

export function armReboot(prev: RebootPendingState, cmd: CliCommand): RebootPendingState {
  const entry = deriveRebootEntry(cmd);
  // Dedup on the command's key, falling back to the label — never string
  // surgery on the name, which breaks for reboot-required commands not shaped
  // 'set <x>'.
  const dedupKey = cmd.key ?? entry.label;
  const existing = prev.settings.find((s) =>
    cmd.key ? s.label === entry.label && s.verify === entry.verify : s.label === dedupKey,
  );
  const settings = existing ? prev.settings : [...prev.settings, entry];
  return { ...prev, settings, dismissed: false };
}

export function markRebootSent(prev: RebootPendingState, atMs: number): RebootPendingState {
  return { ...prev, rebootSentAtMs: atMs };
}

export function clearIfHeard(prev: RebootPendingState, lastSeenMs: number | undefined): RebootPendingState {
  if (prev.rebootSentAtMs == null) return prev;
  if (lastSeenMs != null && lastSeenMs > prev.rebootSentAtMs) return EMPTY_REBOOT;
  return prev;
}

export interface RebootStripProps {
  pending: RebootPendingState;
  onRunVerify: (verify: string) => void;
  onRebootNow: () => void;
  onDismiss: () => void;
}

export function RebootStrip({ pending, onRunVerify, onRebootNow, onDismiss }: RebootStripProps) {
  if (pending.settings.length === 0 || pending.dismissed) return null;
  const rebooting = pending.rebootSentAtMs != null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-cs-warn/30 bg-cs-warn/10 px-4 py-2 text-[11px]">
      <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-cs-warn" />
      {rebooting ? (
        <span className="text-cs-text-muted">Rebooting — waiting for the node to be heard again.</span>
      ) : (
        <>
          <span className="text-cs-text-muted">
            {pending.settings.length} setting{pending.settings.length > 1 ? 's' : ''} written but not yet live
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            {pending.settings.map((s) => (
              <button
                key={s.label}
                type="button"
                disabled={!s.verify}
                onClick={() => s.verify && onRunVerify(s.verify)}
                className="rounded border border-cs-border bg-cs-bg-3 px-1.5 py-0.5 font-mono text-[11px] text-cs-text-muted enabled:hover:text-cs-accent disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </span>
          <button
            type="button"
            onClick={onRebootNow}
            className="flex items-center gap-1 rounded border border-cs-accent/30 bg-cs-accent-soft px-2 py-0.5 text-[11px] text-cs-accent"
          >
            <RotateCcw size={11} aria-hidden="true" />
            Reboot now
          </button>
        </>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-auto shrink-0 text-cs-text-dim hover:text-cs-text-muted"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

export function RebootHeaderChip({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-cs-warn/30 bg-cs-warn/10 px-2 py-0.5 text-[11px] text-cs-warn"
    >
      <TriangleAlert size={11} aria-hidden="true" />
      reboot pending · {count}
    </button>
  );
}

export function RebootTabDot() {
  return <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-cs-warn" />;
}
