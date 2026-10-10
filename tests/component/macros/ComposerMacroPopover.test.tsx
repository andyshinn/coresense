import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => import('../../support/notifyMock'));

import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { ComposerMacroPopover } from '@/panels/macros/inchat/ComposerMacroPopover';
import type { MacroTemplate } from '../../../src/shared/macros/types';
import { TEST_CLIENT as client } from '../../support/apiClient';
import { notify } from '../../support/notifyMock';

const macros: MacroTemplate[] = [
  { id: 'a', name: 'Signal report', template: '{{ snr }} snr', scope: 'global', createdAt: 0, updatedAt: 0 },
  { id: 'b', name: 'Relay path', template: 'heard via {{ paths }}', scope: 'global', createdAt: 0, updatedAt: 0 },
];

beforeEach(() => {
  useStore.setState({ macros, channels: [], contacts: [] });
  vi.restoreAllMocks();
});

describe('ComposerMacroPopover', () => {
  it('expands the chosen macro in send context and reports the rendered text', async () => {
    const renderSpy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'expanded text' });
    const onExpand = vi.fn();
    render(<ComposerMacroPopover query="" client={client} targetKey="c:abc" onExpand={onExpand} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /signal report/i }));
    await waitFor(() => expect(onExpand).toHaveBeenCalledWith('expanded text'));
    expect(renderSpy.mock.calls[0][1]).toMatchObject({ macroId: 'a', mode: 'send', contactKey: 'c:abc' });
  });

  // Regression: a transport failure used to reject out of `void choose(...)`,
  // skipping both the toast and onClose, so the popover stayed open.
  it('toasts and still closes when the render request fails', async () => {
    vi.spyOn(api, 'renderMacro').mockRejectedValue(new Error('network down'));
    const onExpand = vi.fn();
    const onClose = vi.fn();
    render(<ComposerMacroPopover query="" client={client} targetKey="c:abc" onExpand={onExpand} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /signal report/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onExpand).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledWith('Couldn’t expand “Signal report”: network down', expect.any(Error));
  });

  it('filters macros by the slash query', () => {
    render(<ComposerMacroPopover query="relay" client={client} onExpand={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /signal report/i })).toBeNull();
    expect(screen.getByRole('button', { name: /relay path/i })).toBeTruthy();
  });
});
