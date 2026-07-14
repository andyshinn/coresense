import { Progress } from 'coresense';

// Dark "Field Console" surface, sized like the left-nav connection footer where
// the sync bar lives.
function Surface({ children }) {
  return (
    <div className="w-72 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">{children}</div>
  );
}

export function SyncingContacts() {
  return (
    <Surface>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cs-text-muted">Syncing contacts</span>
          <span className="tabular-nums text-cs-text-dim">3/20</span>
        </div>
        <Progress value={15} aria-label="Syncing contacts" />
      </div>
    </Surface>
  );
}

export function FirmwareUpload() {
  return (
    <Surface>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cs-text-muted">Firmware upload · Heltec V3</span>
          <span className="tabular-nums text-cs-text-dim">60%</span>
        </div>
        <Progress value={60} aria-label="Firmware upload" />
      </div>
    </Surface>
  );
}

export function Complete() {
  return (
    <Surface>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-cs-text-muted">Channel keys imported</span>
          <span className="tabular-nums text-cs-accent">Done</span>
        </div>
        <Progress value={100} aria-label="Import complete" />
      </div>
    </Surface>
  );
}

export function States() {
  return (
    <Surface>
      <div className="flex flex-col gap-4">
        <Progress value={15} aria-label="15 percent" />
        <Progress value={60} aria-label="60 percent" />
        <Progress value={100} aria-label="100 percent" />
      </div>
    </Surface>
  );
}
