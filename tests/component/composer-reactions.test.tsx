import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, test } from 'vitest';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { DEFAULT_RADIO_SETTINGS } from '../../src/shared/types';

const baseProps = {
  onSend: async () => {},
  returnToSend: true,
  radioSettings: DEFAULT_RADIO_SETTINGS,
};

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

describe('Composer reply-context chip', () => {
  test('shows the chip and fires onClearReply on clear', () => {
    let cleared = false;
    render(
      <Composer
        {...baseProps}
        replyingTo="K5TH"
        onClearReply={() => {
          cleared = true;
        }}
      />,
    );
    expect(screen.getByText('K5TH')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Cancel reply'));
    expect(cleared).toBe(true);
  });
});
