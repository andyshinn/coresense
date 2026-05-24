import type { Channel, Contact } from '../../../../shared/types';
import type { PaletteItem } from '../types';
import { resolveKeyItem } from './tools';

export interface BuildRecentArgs {
  recentKeys: string[];
  activeKey: string;
  channels: Channel[];
  contacts: Contact[];
  setActiveKey: (key: string) => void;
  close: () => void;
}

export function buildRecentItems({
  recentKeys,
  activeKey,
  channels,
  contacts,
  setActiveKey,
  close,
}: BuildRecentArgs): PaletteItem[] {
  const list: PaletteItem[] = [];
  for (const key of recentKeys) {
    if (key === activeKey) continue;
    const item = resolveKeyItem(key, channels, contacts);
    if (!item) continue;
    list.push({
      ...item,
      group: 'recent',
      groupLabel: 'Recent',
      run: () => {
        setActiveKey(key);
        close();
      },
    });
  }
  return list;
}
