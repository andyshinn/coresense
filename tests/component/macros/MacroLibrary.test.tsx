import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => import('../../support/notifyMock'));

import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { MacroLibrary } from '@/panels/macros/MacroLibrary';
import type { MacroTemplate } from '../../../src/shared/macros/types';
import { TEST_CLIENT as client } from '../../support/apiClient';
import { renderWithClient } from '../../support/renderWithClient';

const macros: MacroTemplate[] = [
  { id: 'a', name: 'Signal report', template: '{{ snr }} snr', scope: 'global', createdAt: 0, updatedAt: 0 },
  {
    id: 'b',
    name: 'Relay path',
    template: 'heard via {{ paths }}',
    scope: 'channel',
    channelKey: 'ch:testing',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'c',
    name: 'Repeater nudge',
    template: '{{ peer_name }} hop',
    scope: 'contact',
    contactKey: 'c:abc',
    createdAt: 0,
    updatedAt: 0,
  },
];

beforeEach(() => {
  useStore.setState({
    macros,
    channels: [{ key: 'ch:testing', name: 'testing', kind: 'hashtag' }],
    contacts: [],
  });
  vi.restoreAllMocks();
});

describe('MacroLibrary', () => {
  it('lists every macro', () => {
    renderWithClient(<MacroLibrary onNew={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('Signal report')).toBeTruthy();
    expect(screen.getByText('Relay path')).toBeTruthy();
    expect(screen.getByText('Repeater nudge')).toBeTruthy();
  });

  it('filters by search query', () => {
    renderWithClient(<MacroLibrary onNew={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-search'), { target: { value: 'relay' } });
    expect(screen.queryByText('Signal report')).toBeNull();
    expect(screen.getByText('Relay path')).toBeTruthy();
  });

  it('filters by scope chip', () => {
    renderWithClient(<MacroLibrary onNew={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('scope-filter-contact'));
    expect(screen.queryByText('Signal report')).toBeNull();
    expect(screen.getByText('Repeater nudge')).toBeTruthy();
  });

  it('calls onNew when the New macro button is clicked', () => {
    const onNew = vi.fn();
    renderWithClient(<MacroLibrary onNew={onNew} onEdit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /new macro/i }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('calls onEdit with the macro when its Edit action is clicked', () => {
    const onEdit = vi.fn();
    renderWithClient(<MacroLibrary onNew={vi.fn()} onEdit={onEdit} />);
    const editButtons = screen.getAllByRole('button', { name: /^edit /i });
    fireEvent.click(editButtons[0]);
    expect(onEdit).toHaveBeenCalledWith(macros[0]);
  });

  it('confirms before deleting, then deletes through the API', async () => {
    const spy = vi.spyOn(api, 'deleteMacro').mockResolvedValue({ ok: true });
    renderWithClient(<MacroLibrary onNew={vi.fn()} onEdit={vi.fn()} />);
    const delButtons = screen.getAllByRole('button', { name: /^delete /i });
    fireEvent.click(delButtons[0]);
    // The first click only opens the confirmation — nothing deleted yet.
    expect(spy).not.toHaveBeenCalled();
    const confirm = await screen.findByTestId('confirm-delete');
    fireEvent.click(confirm);
    expect(spy).toHaveBeenCalledWith(client, 'a');
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const spy = vi.spyOn(api, 'deleteMacro').mockResolvedValue({ ok: true });
    renderWithClient(<MacroLibrary onNew={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^delete /i })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows an empty state when nothing matches', () => {
    renderWithClient(<MacroLibrary onNew={vi.fn()} onEdit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-search'), { target: { value: 'zzzzz' } });
    expect(screen.getByText(/no macros/i)).toBeTruthy();
  });
});
