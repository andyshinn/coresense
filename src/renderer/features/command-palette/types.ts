import type { LucideIcon } from 'lucide-react';

export type PaletteGroup = 'recent' | 'pinned' | 'goto' | 'action';

/** Section heading for each group. Sections render in item order. */
export const GROUP_LABEL: Record<PaletteGroup, string> = {
  recent: 'Recent',
  pinned: 'Pinned',
  goto: 'Go to',
  action: 'Actions',
};

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: PaletteGroup;
  icon: LucideIcon;
  keywords?: string;
  run: () => void;
}

export interface ToolItem {
  key: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}
