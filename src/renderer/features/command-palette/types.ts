import type { LucideIcon } from 'lucide-react';

export type PaletteGroup = 'recent' | 'pinned' | 'goto' | 'action';

export interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  group: PaletteGroup;
  groupLabel: string;
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
