import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../../components/ui/sidebar';
import { useStore } from '../../lib/store';
import { ACTIVE_BUTTON_CLASS } from './atoms';
import { TOOLS } from './constants';

/** The static Tools group below the conversations, with the macro count badge. */
export function ToolsGroup({ activeKey }: { activeKey: string }) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const macroCount = useStore((s) => s.macros.length);
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Tools</SidebarGroupLabel>
      <SidebarMenu>
        {TOOLS.map((t) => (
          <SidebarMenuItem key={t.key}>
            <SidebarMenuButton
              tooltip={t.label}
              isActive={activeKey === t.key}
              onClick={() => setActiveKey(t.key)}
              className={ACTIVE_BUTTON_CLASS}
            >
              <t.icon />
              <span>{t.label}</span>
              {t.key === 'tool:macros' && macroCount > 0 && (
                <span className="ml-auto font-mono text-[10px] text-cs-text-dim">{macroCount}</span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
