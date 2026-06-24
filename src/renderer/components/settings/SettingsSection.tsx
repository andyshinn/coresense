import { Badge, Box, Button, Flex, Heading, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';

interface SettingsSectionProps {
  /** Stable id — also the `data-section` anchor for scroll-spy / jump rail. */
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  footnote?: string;
  dirty: boolean;
  saving?: boolean;
  /** When false the Save button stays disabled (e.g. no API client). */
  canSave?: boolean;
  /** Omit for read-only sections — no Save button / badge is rendered. */
  onSave?: () => void;
  children: ReactNode;
}

// Presentational per-section wrapper for the redesigned Settings panel: icon +
// title header, an "Unsaved" badge + Save button when dirty, and a footnote.
// Dirty state is owned by the section container (via useSettingsSection) and
// passed in — this component is purely visual.
export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  footnote,
  dirty,
  saving,
  canSave = true,
  onSave,
  children,
}: SettingsSectionProps) {
  return (
    <Box asChild style={{ scrollMarginTop: '1rem' }}>
      <section data-section={id}>
        <Flex direction="column" gap="3" py="5" style={{ borderBottom: '1px solid var(--gray-a4)' }}>
          <Flex align="start" gap="3">
            <Box flexGrow="1">
              <Heading size="2" as="h2">
                <Flex align="center" gap="2">
                  <span className="inline-flex shrink-0" style={{ color: 'var(--accent-9)' }}>
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  {title}
                </Flex>
              </Heading>
              {description && (
                <Text as="p" size="1" color="gray" mt="1" style={{ maxWidth: '28.75rem' }}>
                  {description}
                </Text>
              )}
            </Box>
            {onSave && (
              <Flex flexShrink="0" align="center" gap="2">
                {dirty && (
                  <Badge color="amber" variant="soft">
                    Unsaved
                  </Badge>
                )}
                <Button size="1" onClick={onSave} disabled={!dirty || !canSave || saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </Flex>
            )}
          </Flex>
          <Flex direction="column" gap="1">
            {children}
          </Flex>
          {footnote && (
            <Text size="1" color="gray" style={{ fontStyle: 'italic', paddingLeft: '0.5rem', paddingRight: '0.5rem' }}>
              {footnote}
            </Text>
          )}
        </Flex>
      </section>
    </Box>
  );
}
