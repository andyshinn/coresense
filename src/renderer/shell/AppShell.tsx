import { PanelRightOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '../components/ui/sidebar';
import { useStore } from '../lib/store';
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
}

export function AppShell({ title, children, showShell = true }: AppShellProps) {
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
          // No "show left nav" toggle: the sidebar is collapsible="icon", so it
          // never fully hides and its icon rail is always there to reopen it.
          <RailToggles rightOpen={rightOpen} onToggleRight={toggleRightRail} />
        }
      />
      <SidebarProvider
        open={leftOpen}
        onOpenChange={(v) => {
          if (v !== leftOpen) toggleLeftNav();
        }}
        className="flex-1 overflow-hidden"
      >
        <LeftNav />
        <SidebarInset className="flex flex-1 flex-col overflow-hidden bg-cs-bg">{children}</SidebarInset>
        {rightOpen && <RightRail />}
      </SidebarProvider>
    </div>
  );
}

function RailToggles({ rightOpen, onToggleRight }: { rightOpen: boolean; onToggleRight: () => void }) {
  if (rightOpen) return null;
  return (
    <button
      type="button"
      onClick={onToggleRight}
      title="Show right rail (⌘.)"
      aria-label="Show right rail"
      className="titlebar-no-drag rounded p-1 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text"
    >
      <PanelRightOpen size={12} />
    </button>
  );
}
