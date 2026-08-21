import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { Composer } from '@/components/Composer';
import { useStore } from '@/lib/store';
import { DEFAULT_RADIO_SETTINGS } from '../../src/shared/types';

const baseProps = {
  onSend: async () => {},
  returnToSend: true,
  radioSettings: DEFAULT_RADIO_SETTINGS,
};

const input = () => screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

afterEach(() => {
  act(() => {
    useStore.setState({ drafts: {} });
  });
});

describe('Composer draft persistence', () => {
  test('typing stores the draft under its conversation key', () => {
    render(<Composer {...baseProps} draftKey="ch:one" />);
    type('hello');
    expect(useStore.getState().drafts['ch:one']).toBe('hello');
  });

  test('clearing the field removes the entry rather than storing an empty string', () => {
    render(<Composer {...baseProps} draftKey="ch:one" />);
    type('hello');
    type('');
    expect(useStore.getState().drafts).not.toHaveProperty('ch:one');
  });

  test('switching conversation swaps the visible draft without remounting', () => {
    const view = render(<Composer {...baseProps} draftKey="ch:one" />);
    type('first');
    view.rerender(<Composer {...baseProps} draftKey="ch:two" />);
    expect(input().value).toBe('');

    type('second');
    view.rerender(<Composer {...baseProps} draftKey="ch:one" />);
    expect(input().value).toBe('first');
    expect(useStore.getState().drafts).toEqual({ 'ch:one': 'first', 'ch:two': 'second' });
  });

  test('sending clears the draft entry', async () => {
    const sent: string[] = [];
    render(<Composer {...baseProps} onSend={async (b) => void sent.push(b)} draftKey="ch:one" />);
    type('ship it');

    await act(async () => {
      fireEvent.click(screen.getByTestId('message-send-button'));
    });

    expect(sent).toEqual(['ship it']);
    expect(useStore.getState().drafts).not.toHaveProperty('ch:one');
  });

  // The whole point of the split: typing must not allocate a new `ui` object,
  // so no `ui` consumer can ever be dragged onto the keystroke path again.
  test('typing does not touch the ui slice', () => {
    render(<Composer {...baseProps} draftKey="ch:one" />);
    const before = useStore.getState().ui;
    type('hello');
    expect(useStore.getState().ui).toBe(before);
  });
});
