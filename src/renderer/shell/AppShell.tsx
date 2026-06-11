import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar';
import type { ApiClient } from '../lib/api';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';
import { LeftNav } from './leftnav';
import { RightRail } from './rightrail';
import { TitleBar } from './TitleBar';
import { useDeselectOnOutsideClick } from './useDeselectOnOutsideClick';

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

  // Deselect the active message when the user clicks off it (empty space, the
  // composer, the left nav, …). See the hook for why this is needed and how it
  // avoids dismissing on clicks inside the detail rail.
  useDeselectOnOutsideClick();

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
            // When the sidebar is in icon mode, the rail itself is still visible — only
            // expose the "show left nav" button when the user has fully hidden it. Since
            // collapsible="icon" never fully hides, hide this button when leftOpen is
            // also false (icon rail visible) too.
            leftOpen={true}
            rightOpen={rightOpen}
            onToggleLeft={toggleLeftNav}
            onToggleRight={toggleRightRail}
          />
        }
      />
      <SidebarProvider
        open={leftOpen}
        onOpenChange={(v) => {
          if (v !== leftOpen) toggleLeftNav();
        }}
        className="flex-1 overflow-hidden"
      >
        <LeftNav client={client} />
        <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-cs-bg">
          {children}
        </SidebarInset>
        {rightOpen && <RightRail client={client} />}
      </SidebarProvider>
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
