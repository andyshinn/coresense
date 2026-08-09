import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CliCommand } from '../../../../shared/repeater-cli/catalog';

export interface CliConfirmBarProps {
  text: string;
  cmd: CliCommand;
  onConfirm: () => void;
  onCancel: () => void;
}

function HoldToSend({ label, onComplete }: { label: string; onComplete: () => void }) {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    setHeld(true);
    timer.current = setTimeout(() => {
      setHeld(false);
      onComplete();
    }, 900);
  };
  const cancel = () => {
    setHeld(false);
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <button
      type="button"
      onMouseDown={start}
      onMouseUp={cancel}
      onMouseLeave={cancel}
      onTouchStart={start}
      onTouchEnd={cancel}
      className="relative shrink-0 overflow-hidden rounded border border-cs-danger/30 bg-cs-danger/15 px-3 text-[12px] font-medium text-cs-danger"
      style={{ height: 28 }}
    >
      <span
        className="absolute inset-y-0 left-0 bg-cs-danger/30"
        style={{ width: held ? '100%' : '0%', transition: held ? 'width 900ms linear' : 'width 120ms ease-out' }}
      />
      <span className="relative">{label}</span>
    </button>
  );
}

export function CliConfirmBar({ text, cmd, onConfirm, onCancel }: CliConfirmBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-cs-danger/30 bg-cs-danger/10 px-4 py-2">
      <AlertTriangle size={14} aria-hidden="true" className="shrink-0 text-cs-danger" />
      <span className="text-[12px] leading-snug text-cs-text" style={{ textWrap: 'pretty', flex: '1 1 220px', minWidth: 0 }}>
        <span className="font-mono text-cs-danger">{text}</span>
        <span className="text-cs-text-muted"> — {cmd.note ?? 'This cannot be undone from here.'}</span>
        {cmd.noReply ? <span className="text-cs-text-dim"> The node will not confirm.</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <HoldToSend label="Hold to send" onComplete={onConfirm} />
        <button type="button" onClick={onCancel} className="text-[12px] text-cs-text-muted" style={{ height: 28 }}>
          Cancel
        </button>
      </span>
    </div>
  );
}
