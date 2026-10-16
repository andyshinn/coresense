import type { ActiveKey } from '../../../../shared/keys';
import type { Channel, Contact } from '../../../../shared/types';
import type { PaletteItem } from '../types';
import { resolveKeyItem } from './tools';

export interface BuildRecentArgs {
  recentKeys: ActiveKey[];
  activeKey: string;
  channels: Channel[];
  contacts: Contact[];
  setActiveKey: (key: ActiveKey) => void;
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
      run: () => {
        setActiveKey(key);
        close();
      },
    });
  }
  return list;
}
