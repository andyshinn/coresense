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

  it('documents the json and inspect debug filters', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText: vi.fn() } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /filters/i }));
    expect(screen.getByRole('button', { name: /insert json filter/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /insert inspect filter/i })).toBeTruthy();
  });

  it('inserts the json stub with an indent argument', () => {
    const insertText = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /insert json filter/i }));
    expect(insertText).toHaveBeenCalledWith(' | json: 2');
  });

  it('suggests short_id for map, the field that is always populated', () => {
    const insertText = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /insert map filter/i }));
    expect(insertText).toHaveBeenCalledWith(' | map: "short_id"');
  });

  it('wraps variable rows in a hover-card trigger', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText: vi.fn() } });
    const { container } = render(<MacroReferenceRail />);
    expect(container.querySelector('[data-slot="hover-card-trigger"]')).toBeTruthy();
  });

  it('shows a Context tab listing sample fields with type and value', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText: vi.fn() } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    // Query by row, not by text: my_name and my_callsign share the value
    // "N0CALL", so getByText would match two elements and throw.
    const row = screen.getByTestId('ctx-row-my_name');
    expect(row.textContent).toContain('my_name');
    expect(row.textContent).toContain('N0CALL');
    expect(row.textContent).toContain('string');
  });

  it('expands a nested object and inserts the dotted path', () => {
    const insertText = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    fireEvent.click(screen.getByRole('button', { name: /expand my_pos/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert my_pos.lat' }));
    expect(insertText).toHaveBeenCalledWith('{{ my_pos.lat }}');
  });

  it('reflects the send-mode context, where reply-only variables are null', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'send', insertVar: vi.fn(), insertText: vi.fn() } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    const row = screen.getByTestId('ctx-row-sender_name');
    expect(row.textContent).toContain('null');
  });
});
