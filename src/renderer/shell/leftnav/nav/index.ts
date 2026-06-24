/**
 * Local Radix nav-shell — replaces the shadcn `components/ui/sidebar` primitives.
 *
 * Component / prop names mirror the shadcn sidebar so the left-nav consumers
 * (Task 5.2–5.6) can swap `ui/sidebar` imports for this module 1:1:
 *
 *   Sidebar              → NavRoot
 *   useSidebar           → useNav
 *   SidebarHeader        → NavHeader
 *   SidebarFooter        → NavFooter
 *   SidebarContent       → NavContent
 *   SidebarGroup         → NavGroup
 *   SidebarGroupLabel    → NavGroupLabel
 *   SidebarRail          → NavRail
 *   SidebarMenu          → NavMenu
 *   SidebarMenuItem      → NavItem
 *   SidebarMenuButton    → NavButton
 *   SidebarMenuAction    → NavAction
 *   SidebarMenuSub       → NavSub
 *   SidebarMenuSubItem   → NavSubItem
 *   SidebarMenuSubButton → NavSubButton
 */

export { NavButton, type NavButtonProps } from './NavButton';
export { NavGroup, NavGroupLabel } from './NavGroup';
export { NavAction, NavItem, NavMenu } from './NavItem';
export { NavContent, NavFooter, NavHeader, NavRail, NavRoot, useNav } from './NavRoot';
export { NavSub, NavSubButton, NavSubItem } from './NavSub';
