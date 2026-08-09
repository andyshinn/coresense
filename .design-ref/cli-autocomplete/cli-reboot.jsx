// cli-reboot.jsx — the "reboot needed" indicator. A reboot-required `set` leaves
// unapplied config on a remote node, which is closer to unsaved changes than to a
// notification: dismissing it must not delete the fact. So the loud strip demotes
// into three quiet, permanent signals instead of disappearing.
const { Button: RButton, HoverCard: RHoverCard, HoverCardTrigger: RHoverCardTrigger, HoverCardContent: RHoverCardContent } = window.CoreSenseUI;
const RIcons = window.CLIIcons;

const REBOOT_STORE = 'coresense.cli.pendingReboot.';

function loadPendingReboot(pubkey) {
  try {
    const raw = localStorage.getItem(REBOOT_STORE + pubkey);
    if (!raw) return { settings: [], dismissed: false, rebooting: false };
    const p = JSON.parse(raw);
    return { settings: p.settings || [], dismissed: !!p.dismissed, rebooting: false };
  } catch (e) { return { settings: [], dismissed: false, rebooting: false }; }
}
function savePendingReboot(pubkey, p) {
  try { localStorage.setItem(REBOOT_STORE + pubkey, JSON.stringify({ settings: p.settings, dismissed: p.dismissed })); } catch (e) { /* storage unavailable */ }
}

// ── Tier one: the strip above the prompt ───────────────────────────────
function RebootStrip({ pending, onReboot, onDismiss, onVerify }) {
  if (pending.rebooting) {
    return (
      <div className="cli-tint-warn flex items-center gap-2.5 border-t px-4 py-2">
        <span className="cli-spin shrink-0 text-cs-warn"><RIcons.Power size={14} /></span>
        <span className="text-[12px] leading-snug text-cs-text">
          <span className="font-medium text-cs-warn">Rebooting</span>
          <span className="text-cs-text-muted"> — the node drops off the mesh for about 30 s. This clears when it is next heard.</span>
        </span>
      </div>
    );
  }
  const n = pending.settings.length;
  return (
    <div className="cli-tint-warn flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-t px-4 py-2">
      <RIcons.Alert size={14} className="shrink-0 text-cs-warn" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-cs-warn">Reboot pending</span>
      <span className="text-[12px] text-cs-text-muted">
        {n} setting{n === 1 ? '' : 's'} written but not applied
      </span>
      <span className="flex flex-wrap items-center gap-1" style={{ flex: '1 1 auto' }}>
        {pending.settings.map((s) => (
          <button key={s.label} onClick={() => s.verify && onVerify(s.verify)} title={s.verify ? `Check with ${s.verify}` : undefined}
            className="rounded border border-cs-border-strong bg-cs-bg-3 px-1.5 font-mono text-[11px] text-cs-text-muted transition-colors hover:border-cs-accent/40 hover:text-cs-accent" style={{ lineHeight: '17px' }}>{s.label}</button>
        ))}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <RButton size="sm" onClick={onReboot} className="gap-1.5 px-2.5 text-[12px]" style={{ height: 26 }}>
          <RIcons.Power size={12} />Reboot now
        </RButton>
        <RButton size="sm" variant="ghost" onClick={onDismiss} className="px-1.5 text-cs-text-dim" style={{ height: 26 }} title="Keep the reminder, hide this bar">
          <RIcons.X size={13} />
        </RButton>
      </span>
    </div>
  );
}

// ── Tier two: quiet signals that survive dismissal ─────────────────────
function RebootTabDot() {
  return <span className="rounded-full bg-cs-warn" style={{ width: 5, height: 5, boxShadow: '0 0 6px rgb(var(--cs-warn))' }} />;
}

function RebootHeaderChip({ pending, onClick }) {
  const n = pending.settings.length;
  return (
    <RHoverCard openDelay={180} closeDelay={80}>
      <RHoverCardTrigger asChild>
        <button onClick={onClick} className="cli-tint-warn inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 text-[11px] text-cs-warn" style={{ height: 20 }}>
          <RIcons.Alert size={10} sw={2} />
          {pending.rebooting ? 'rebooting' : `reboot pending${n > 1 ? ` · ${n}` : ''}`}
        </button>
      </RHoverCardTrigger>
      <RHoverCardContent side="bottom" align="start" sideOffset={8} className="w-72 border-cs-border-strong bg-cs-bg-2 p-3">
        <div className="text-[12px] font-medium text-cs-text">Written but not applied</div>
        <p className="mt-1 text-[11px] leading-snug text-cs-text-muted" style={{ textWrap: 'pretty' }}>
          These settings are stored on the node and take effect on its next reboot.
        </p>
        <div className="mt-2 flex flex-col gap-1">
          {pending.settings.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="font-mono text-cs-text">{s.label}</span>
              {s.verify && <span className="font-mono text-cs-text-dim">{s.verify}</span>}
            </div>
          ))}
        </div>
        <div className="mt-2.5 border-t border-cs-border pt-2 text-[11px] text-cs-text-dim">Click to reopen the reboot bar.</div>
      </RHoverCardContent>
    </RHoverCard>
  );
}

function RebootRailRow({ pending, onClick }) {
  const n = pending.settings.length;
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-cs-text-dim">Pending</span>
      <button onClick={onClick} className="truncate text-right text-[11px] text-cs-warn hover:underline">
        {pending.rebooting ? 'rebooting…' : `reboot · ${n} setting${n === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}

Object.assign(window, { RebootStrip, RebootTabDot, RebootHeaderChip, RebootRailRow, loadPendingReboot, savePendingReboot });
