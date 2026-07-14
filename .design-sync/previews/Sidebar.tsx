import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from 'coresense';
import { Hash, Radio, Users } from 'lucide-react';

// collapsible="none" renders the sidebar as a plain flex column (no fixed
// positioning), which previews cleanly. cfg.overrides.Sidebar pins
// cardMode:single + a sidebar-width viewport.
export function MeshNav() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="none" className="h-[460px] border-r border-cs-border">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1 text-sm font-semibold text-cs-text">
            <Radio className="size-4 text-cs-accent" /> CoreSense
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Channels</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>
                  <Hash /> general
                </SidebarMenuButton>
                <SidebarMenuBadge>3</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Hash /> field-ops
                </SidebarMenuButton>
                <SidebarMenuBadge>12</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Hash /> weather
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Contacts</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Users /> Ridgeline Repeater
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Users /> Basecamp Node
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <Users /> Trailhead
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-cs-online">
            <span className="size-2 rounded-full bg-cs-online" /> Connected · 8 nodes
          </div>
        </SidebarFooter>
      </Sidebar>
    </SidebarProvider>
  );
}
