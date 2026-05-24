import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import type { ReactNode } from 'react';
import { SidebarMenuButton, SidebarMenuItem } from '../../components/ui/sidebar';

/** Inner branch nested inside a SidebarMenuSub (chevron-first sub-row with own collapsible). */
export function KindBranch({
  label,
  icon: Icon,
  open,
  onToggle,
  unreadTotal,
  children,
}: {
  label: string;
  icon: LucideIcon;
  open: boolean;
  onToggle: () => void;
  unreadTotal: number;
  children: ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <Collapsible.Root
        open={open}
        onOpenChange={onToggle}
        className="group/kind [&[data-state=open]>button>svg:first-child]:rotate-90"
      >
        <Collapsible.Trigger asChild>
          <SidebarMenuButton className="h-7 text-xs">
            <ChevronRight className="transition-transform" />
            <Icon />
            <span>{label}</span>
            {unreadTotal > 0 && (
              <span
                role="status"
                aria-label={`${unreadTotal} unread`}
                className="ml-auto rounded-full bg-cs-accent px-1.5 py-px font-mono text-[10px] leading-none text-cs-bg tabular-nums"
              >
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            )}
          </SidebarMenuButton>
        </Collapsible.Trigger>
        <Collapsible.Content>{children}</Collapsible.Content>
      </Collapsible.Root>
    </SidebarMenuItem>
  );
}
