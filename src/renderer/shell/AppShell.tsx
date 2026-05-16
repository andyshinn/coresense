import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';
import { LeftNav } from './LeftNav';
import { RightRail } from './RightRail';
import { TitleBar } from './TitleBar';

interface AppShellProps {
  title?: string;
  children: ReactNode;
  // When false (e.g. the API-key gate), render only TitleBar + children with
  // no left/right panes. Lets the gate take the whole window.
  showShell?: boolean;
  client?: ApiClient | null;
}

export function AppShell({ title, children, showShell = true, client = null }: AppShellProps) {
  const leftOpen = useStore((s) => s.ui.leftOpen);
  const rightOpen = useStore((s) => s.ui.rightOpen);
  const toggleLeftNav = useStore((s) => s.toggleLeftNav);
  const toggleRightRail = useStore((s) => s.toggleRightRail);

  if (!showShell) {
    return (
      <div className="flex h-full flex-col bg-cs-bg text-cs-text">
        <TitleBar title={title} />
        <div className="flex flex-1 overflow-hidden">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-cs-bg text-cs-text">
      <TitleBar
        title={title}
        trailing={
          <RailToggles
            leftOpen={leftOpen}
            rightOpen={rightOpen}
            onToggleLeft={toggleLeftNav}
            onToggleRight={toggleRightRail}
          />
        }
      />
      <div className="flex flex-1 overflow-hidden">
        {leftOpen && <LeftNav client={client} />}
        <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
        {rightOpen && <RightRail client={client} />}
      </div>
    </div>
  );
}

function RailToggles({
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}: {
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}) {
  return (
    <>
      {!leftOpen && (
        <button
          type="button"
          onClick={onToggleLeft}
          title="Show left nav (⌘\\)"
          aria-label="Show left nav"
          className={cn(
            'titlebar-no-drag rounded p-1 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text',
          )}
        >
          <PanelLeftOpen size={12} />
        </button>
      )}
      {!rightOpen && (
        <button
          type="button"
          onClick={onToggleRight}
          title="Show right rail (⌘.)"
          aria-label="Show right rail"
          className="titlebar-no-drag rounded p-1 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text"
        >
          <PanelRightOpen size={12} />
        </button>
      )}
    </>
  );
}
