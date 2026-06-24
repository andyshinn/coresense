import { Badge, Flex } from '@radix-ui/themes';
import { type SettingsTab, useStore } from '../../lib/store';

// Small header status pill: App settings are stored locally; Radio/Extra
// reflect the live radio connection.
export function StatusPill({ tab }: { tab: SettingsTab }) {
  const connected = useStore((s) => s.transportState === 'connected');
  const online = tab === 'app' || tab === 'quickActions' ? true : connected;
  const label =
    tab === 'app' || tab === 'quickActions'
      ? 'Local · stored on this machine'
      : connected
        ? 'Radio connected'
        : 'No radio connected';

  return (
    <Badge variant="soft" color={online ? 'green' : 'gray'} size="1">
      <Flex align="center" gap="1">
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: online ? 'var(--green-9)' : 'var(--gray-8)',
            flexShrink: 0,
          }}
        />
        {label}
      </Flex>
    </Badge>
  );
}
