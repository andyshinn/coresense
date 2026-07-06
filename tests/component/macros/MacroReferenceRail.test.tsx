import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { MacroReferenceRail } from '@/shell/rightrail/MacroReferenceRail';

beforeEach(() => {
  useStore.setState({ macroStudioBridge: null });
});

describe('MacroReferenceRail', () => {
  it('prompts to open a macro when no studio is active', () => {
    render(<MacroReferenceRail />);
    expect(screen.getByText(/open or create a macro/i)).toBeTruthy();
  });

  it('inserts a variable through the active studio bridge', () => {
    const insertVar = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'send', insertVar, insertText: vi.fn() } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert my_name' }));
    expect(insertVar).toHaveBeenCalledWith('my_name');
  });

  it('inserts a filter segment through the bridge', () => {
    const insertText = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /insert distance filter/i }));
    expect(insertText).toHaveBeenCalledWith(' | distance: peer_pos');
  });
});
