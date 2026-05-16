import type { ReactNode } from 'react';

interface TitleBarProps {
  title?: string;
  // Right-aligned slot for status chips, connection indicator, etc. Each child
  // should carry the `titlebar-no-drag` class so it remains clickable inside
  // the drag region.
  trailing?: ReactNode;
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

export function TitleBar({ title = 'CoreSense', trailing }: TitleBarProps) {
  return (
    <header className="titlebar-drag flex h-9 shrink-0 items-center border-b border-cs-border bg-cs-bg-2 text-cs-text-muted">
      {/* macOS traffic-light spacer (set via trafficLightPosition: {14, 14}) */}
      {isMac ? <div className="w-19 shrink-0" aria-hidden="true" /> : null}
      <div className="flex-1 truncate px-3 text-center font-mono text-[11px] tracking-wide uppercase">
        {title}
      </div>
      <div className="titlebar-no-drag flex h-full items-center gap-2 px-3">{trailing}</div>
    </header>
  );
}
