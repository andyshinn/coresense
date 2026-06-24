import { Box, Flex, Heading, Select as RadixSelect, ScrollArea, Separator, Switch, Text, TextField } from '@radix-ui/themes';
import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function Section({ title, description, children }: SectionProps) {
  return (
    <Box>
      <Box mb="2">
        <Text
          size="1"
          weight="medium"
          color="gray"
          style={{ textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block' }}
        >
          {title}
        </Text>
        {description && (
          <Text size="1" color="gray" style={{ display: 'block', marginTop: 2 }}>
            {description}
          </Text>
        )}
      </Box>
      <Flex direction="column" gap="1">
        {children}
      </Flex>
      <Separator size="4" my="2" />
    </Box>
  );
}

interface RowProps {
  label: string;
  description?: string;
  control: ReactNode;
  warning?: string;
  /** When true, marks the row as having an unsaved edit (accent dot + border). */
  changed?: boolean;
}

export function Row({ label, description, control, warning, changed }: RowProps) {
  return (
    <Flex
      align="start"
      gap="3"
      px="2"
      py="1"
      style={{
        borderLeft: changed ? '2px solid var(--accent-9)' : '2px solid transparent',
        borderRadius: 'var(--radius-1)',
      }}
    >
      <Box flexGrow="1">
        <Flex align="center" gap="1" style={{ fontSize: 12 }}>
          {changed && (
            <Box
              aria-hidden
              flexShrink="0"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--accent-9)',
              }}
            />
          )}
          <Text size="2">{label}</Text>
        </Flex>
        {description && (
          <Text size="1" color="gray" style={{ display: 'block' }}>
            {description}
          </Text>
        )}
        {warning && (
          <Text size="1" color="amber" style={{ display: 'block', marginTop: 2 }}>
            {warning}
          </Text>
        )}
      </Box>
      <Box flexShrink="0">{control}</Box>
    </Flex>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} size="1" />;
}

interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
}

export function Select<T extends string>({ value, options, onChange, disabled }: SelectProps<T>) {
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled} size="1">
      <RadixSelect.Trigger variant="surface" />
      <RadixSelect.Content>
        {options.map((opt) => (
          <RadixSelect.Item key={opt.value} value={opt.value}>
            {opt.label}
          </RadixSelect.Item>
        ))}
      </RadixSelect.Content>
    </RadixSelect.Root>
  );
}

interface NumberInputProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  width?: string;
  suffix?: string;
}

export function NumberInput({ value, onChange, min, max, step, disabled, width = '96px', suffix }: NumberInputProps) {
  return (
    <Flex align="baseline" gap="1">
      <TextField.Root
        type="number"
        size="1"
        value={String(value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        style={{ width: width.startsWith('w-') ? 96 : width }}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
      />
      {suffix && (
        <Text size="1" color="gray">
          {suffix}
        </Text>
      )}
    </Flex>
  );
}

interface TextInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  width?: string;
}

export function TextInput({ value, onChange, disabled, placeholder, width = '192px' }: TextInputProps) {
  return (
    <TextField.Root
      size="1"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      style={{ width: width.startsWith('w-') ? 192 : width }}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

interface PanelShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function PanelShell({ title, description, actions, children }: PanelShellProps) {
  return (
    <Flex direction="column" height="100%">
      <Flex align="center" gap="3" px="4" py="2" flexShrink="0" style={{ borderBottom: '1px solid var(--gray-a5)' }}>
        <Flex direction="column">
          <Heading size="2">{title}</Heading>
          {description && (
            <Text size="1" color="gray" style={{ fontFamily: 'var(--font-mono)' }}>
              {description}
            </Text>
          )}
        </Flex>
        {actions && (
          <Flex align="center" gap="2" style={{ marginLeft: 'auto' }}>
            {actions}
          </Flex>
        )}
      </Flex>
      <ScrollArea style={{ flex: 1 }}>
        <Box px="4">{children}</Box>
      </ScrollArea>
    </Flex>
  );
}
