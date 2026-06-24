import { Text } from '@radix-ui/themes';

/** Italic dim placeholder used when a section has nothing to show. */
export function Placeholder({ label }: { label: string }) {
  return (
    <Text size="1" style={{ fontStyle: 'italic', color: 'var(--cs-text-dim)' }}>
      {label}
    </Text>
  );
}
