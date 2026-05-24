import type { Channel, Contact } from '../../../../shared/types';
import type { PaletteItem } from '../types';
import { resolveKeyItem } from './tools';

export interface BuildPinnedArgs {
  pinnedKeys: string[];
  activeKey: string;
  channels: Channel[];
  contacts: Contact[];
  setActiveKey: (key: string) => void;
  close: () => void;
}

export function buildPinnedItems({
  pinnedKeys,
  activeKey,
  channels,
  contacts,
  setActiveKey,
  close,
}: BuildPinnedArgs): PaletteItem[] {
  const list: PaletteItem[] = [];
  for (const key of pinnedKeys) {
    if (key === activeKey) continue;
    const item = resolveKeyItem(key, channels, contacts);
    if (!item) continue;
    list.push({
      ...item,
      id: `pinned:${key}`,
      group: 'pinned',
      groupLabel: 'Pinned',
      run: () => {
        setActiveKey(key);
        close();
      },
    });
  }
  return list;
}
