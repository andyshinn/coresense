import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '../../components/ui/sidebar';
import { cn } from '../../lib/utils';

/** Active styling that survives hover for top-level and sub buttons in the left nav. */
export const ACTIVE_BUTTON_CLASS = cn(
  'border-l-2 border-transparent rounded-l-none text-cs-text-muted hover:text-cs-text',
  // Keep icons at full brightness even when the text is dimmed — matches the
  // sub-button CVA, which pins svg color via `[&>svg]:text-sidebar-accent-foreground`.
  // Without this, a top-level button's icon inherits currentColor and dims with the label.
  '[&>svg]:text-cs-text',
  'data-[active=true]:border-cs-accent data-[active=true]:bg-cs-accent-soft/30 data-[active=true]:text-cs-text data-[active=true]:font-normal',
  'data-[active=true]:hover:bg-cs-accent-soft/30 data-[active=true]:hover:text-cs-text',
);

/** Small unread-count pill rendered next to sub-list rows. `muted` renders the
 *  dimmed zero-state used by the always-present Unreads link. */
export function UnreadChip({ count, muted, className }: { count: number; muted?: boolean; className?: string }) {
  return (
    <span
      role="status"
      aria-label={`${count} unread`}
      className={cn(
        'rounded-full px-1.5 py-px font-mono text-[10px] leading-none tabular-nums',
        muted ? 'bg-cs-bg-2 text-cs-text-dim' : 'bg-cs-accent text-cs-bg',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Trailing affordance for capped branches that reveals the rest of the list for the session. */
export function ShowMoreRow({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton onClick={onClick} className="text-cs-text-muted hover:text-cs-text" asChild>
        <button type="button">
          <MoreHorizontal />
          <span>Show {count} more</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

/** Italic empty-state hint rendered inside an empty SidebarMenuSub. */
export function EmptySubHint({ children }: { children: ReactNode }) {
  return (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <span className="px-2 py-1 text-[11px] italic text-cs-text-dim">{children}</span>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}
