import { Flex, Text } from '@radix-ui/themes';
import type { ComponentProps } from 'react';
import { cn } from '../../../lib/utils';

/** ↔ `SidebarGroup`. A full-width column section (e.g. "Conversations", "Tools"). */
export function NavGroup({ className, children, ...props }: ComponentProps<typeof Flex>) {
  return (
    <Flex
      direction="column"
      p="2"
      width="100%"
      data-slot="nav-group"
      className={cn('relative min-w-0', className)}
      {...props}
    >
      {children}
    </Flex>
  );
}

/**
 * ↔ `SidebarGroupLabel`. Small uppercase section heading. Fades/collapses to zero
 * height while the rail is icon-collapsed (handled by `.nav-group-label` in
 * nav.css, applied via the `data-collapsible="icon"` attribute on the root).
 */
export function NavGroupLabel({ className, children, ...props }: ComponentProps<typeof Text>) {
  return (
    <Text
      as="div"
      size="1"
      weight="medium"
      color="gray"
      data-slot="nav-group-label"
      className={cn('nav-group-label', className)}
      style={{
        display: 'flex',
        height: 'var(--space-6)',
        flexShrink: 0,
        alignItems: 'center',
        paddingInline: 'var(--space-2)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        transition: 'margin 200ms ease-linear, opacity 200ms ease-linear',
      }}
      {...props}
    >
      {children}
    </Text>
  );
}
