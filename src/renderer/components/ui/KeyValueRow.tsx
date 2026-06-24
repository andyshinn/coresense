import { Box, DataList, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/** Label/value row — replaces `DetailRow` in LeftNav.tsx and `Field` in RightRail.tsx. */
export function KeyValueRow({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <DataList.Item>
      <DataList.Label minWidth="0">{label}</DataList.Label>
      <DataList.Value title={title}>
        {mono ? (
          <Text size="1" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Text>
        ) : (
          value
        )}
      </DataList.Value>
    </DataList.Item>
  );
}

/** Section wrapper with uppercase title — replaces `DetailSection` in LeftNav.tsx. */
export function KeyValueGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Text size="1" color="gray" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }} mb="2">
        {title}
      </Text>
      <DataList.Root orientation="horizontal" size="1">
        {children}
      </DataList.Root>
    </Box>
  );
}
