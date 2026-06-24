import { Box, Flex, SegmentedControl, Text } from '@radix-ui/themes';
import type { LucideIcon } from 'lucide-react';

export interface PillTab<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** Shows a warn dot on the pill when the tab has unsaved changes. */
  dirty?: boolean;
}

interface PillTabsProps<T extends string> {
  tabs: PillTab<T>[];
  active: T;
  onChange: (id: T) => void;
}

// Custom segmented control for the Settings panel header. Not shadcn Tabs —
// the panel owns its own scroll column so the jump-rail scroll-spy works.
export function PillTabs<T extends string>({ tabs, active, onChange }: PillTabsProps<T>) {
  return (
    <SegmentedControl.Root value={active} onValueChange={(v) => onChange(v as T)} size="1" aria-label="Settings tabs">
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <SegmentedControl.Item key={t.id} value={t.id}>
            <Flex align="center" gap="1">
              <Icon width="14" height="14" aria-hidden />
              <Text size="1">{t.label}</Text>
              {t.dirty && (
                <Box
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--amber-9)',
                    flexShrink: 0,
                  }}
                />
              )}
            </Flex>
          </SegmentedControl.Item>
        );
      })}
    </SegmentedControl.Root>
  );
}
