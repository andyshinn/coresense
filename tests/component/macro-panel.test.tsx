import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MacroChip, MacroPanel } from '@/features/message-actions/MacroPanel';

describe('macros are "soon" placeholders', () => {
  test('the panel lists seed macros with a soon badge', () => {
    render(<MacroPanel open onOpenChange={() => {}}><button type="button">macros</button></MacroPanel>);
    expect(screen.getByText('soon')).toBeTruthy();
    expect(screen.getByText('ACK')).toBeTruthy();
  });

  test('a macro chip renders disabled', () => {
    render(<MacroChip label="ACK" />);
    expect((screen.getByText('ACK').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
