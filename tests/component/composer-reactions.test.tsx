import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { useStore } from '@/lib/store';
import type { Contact } from '../../src/shared/types';
import { DEFAULT_RADIO_SETTINGS } from '../../src/shared/types';

const baseProps = {
  onSend: async () => {},
  returnToSend: true,
  radioSettings: DEFAULT_RADIO_SETTINGS,
};

const contact = (name: string): Contact => ({
  key: `c:${name}`,
  publicKeyHex: name,
  name,
  kind: 'chat',
});

afterEach(() => useStore.setState({ contacts: [] }));

describe('Composer insertReaction', () => {
  test('inserts "@[name] emoji " into the empty field', () => {
    const ref = createRef<ComposerHandle>();
    render(<Composer ref={ref} {...baseProps} />);
    act(() => {
      ref.current?.insertReaction('K5TH', '👍');
    });
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    expect(ta.value).toBe('@[K5TH] 👍 ');
  });
});

describe('Composer text-derived mentions bar', () => {
  test('renders no bar when the field has no mentions', () => {
    render(<Composer {...baseProps} />);
    expect(screen.queryByTestId('composer-mentions')).toBeNull();
  });

  test('renders a chip for a mention inserted via the ref', () => {
    const ref = createRef<ComposerHandle>();
    render(<Composer ref={ref} {...baseProps} />);
    act(() => {
      ref.current?.insertReaction('K5TH', '👍');
    });
    expect(screen.getByText('@K5TH')).toBeTruthy();
  });

  test('lists every unique mention, de-duplicated, in order', () => {
    render(<Composer {...baseProps} />);
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@[Alice] hi @[Bob] @[Alice]' } });
    const bar = screen.getByTestId('composer-mentions');
    expect(
      within(bar)
        .getAllByText(/^@/)
        .map((n) => n.textContent),
    ).toEqual(['@Alice', '@Bob']);
  });

  test('drops a chip when its mention token is broken', () => {
    render(<Composer {...baseProps} />);
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@[TLF] ' } });
    expect(screen.getByText('@TLF')).toBeTruthy();
    fireEvent.change(ta, { target: { value: '@[TLF ' } });
    expect(screen.queryByText('@TLF')).toBeNull();
  });

  test('styles a known contact differently from an unknown name', () => {
    useStore.setState({ contacts: [contact('Alice')] });
    render(<Composer {...baseProps} />);
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@[Alice] @[Zzz]' } });
    expect(screen.getByText('@Alice').className).toContain('bg-cs-accent-soft/20');
    expect(screen.getByText('@Zzz').className).toContain('bg-cs-bg-3');
  });
});
