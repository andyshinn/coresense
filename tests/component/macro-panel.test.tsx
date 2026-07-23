import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { MacroChip, MacroPanel } from '@/features/message-actions/MacroPanel';
import { type ApiClient, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { MacroTemplate } from '../../src/shared/macros/types';
import type { Message } from '../../src/shared/types';

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const message: Message = { id: 'm1', key: 'ch:x', fromPublicKeyHex: 'a3f9', body: 'hi', ts: 0, state: 'received' };

const signal: MacroTemplate = {
  id: 'a',
  name: 'Signal report',
  template: '{{ snr }} snr',
  scope: 'global',
  createdAt: 0,
  updatedAt: 0,
};
const relaying: MacroTemplate = { ...signal, id: 'b', name: 'Relaying', template: 'relaying now' };

function renderPanel(macros: MacroTemplate[], onPick = vi.fn()) {
  render(
    <MacroPanel open onOpenChange={() => {}} macros={macros} client={client} message={message} onPick={onPick}>
      <button type="button">macros</button>
    </MacroPanel>,
  );
  return onPick;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useStore.setState({ macros: [signal, relaying] });
});

describe('MacroPanel', () => {
  test('lists the macros it is given, with no "soon" badge', () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'rendered' });
    renderPanel([signal, relaying]);
    expect(screen.getByText('Signal report')).toBeTruthy();
    expect(screen.getByText('Relaying')).toBeTruthy();
    expect(screen.queryByText('soon')).toBeNull();
  });

  test('shows each macro rendered in reply mode, with a character count', async () => {
    const spy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: '6.5 snr' });
    renderPanel([signal]);
    await waitFor(() => expect(screen.getByText('6.5 snr')).toBeTruthy());
    expect(screen.getByText('7c')).toBeTruthy();
    expect(spy.mock.calls[0][1]).toMatchObject({ macroId: 'a', mode: 'reply', messageId: 'm1' });
  });

  test('flags a render that overflows the 132-char message cap', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'x'.repeat(141) });
    renderPanel([signal]);
    const count = await screen.findByText('141c');
    expect(count.className).toContain('text-cs-danger');
  });

  test('a row click reports the already-rendered text and issues no second render', async () => {
    const spy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: '6.5 snr' });
    const onPick = renderPanel([signal]);
    await waitFor(() => expect(screen.getByText('6.5 snr')).toBeTruthy());
    fireEvent.click(screen.getByText('Signal report'));
    expect(onPick).toHaveBeenCalledWith(signal, '6.5 snr');
    expect(spy).toHaveBeenCalledTimes(1); // the preview render only
  });

  test('a failed render leaves the row clickable with no cached text', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({
      ok: false,
      error: { kind: 'unknown-variable', message: 'no such variable' },
    });
    const onPick = renderPanel([signal]);
    await waitFor(() => expect(screen.getByText('no such variable')).toBeTruthy());
    fireEvent.click(screen.getByText('Signal report'));
    expect(onPick).toHaveBeenCalledWith(signal, undefined);
  });

  test('empty store: points at the Macros tool', () => {
    useStore.setState({ macros: [] });
    renderPanel([]);
    expect(screen.getByText(/No macros yet/i)).toBeTruthy();
  });

  test('macros exist but none apply here: says so', () => {
    renderPanel([]);
    expect(screen.getByText(/No macros for this conversation/i)).toBeTruthy();
  });
});

describe('MacroChip', () => {
  test('renders the macro name and is enabled', () => {
    render(<MacroChip macro={signal} onPick={() => {}} />);
    const button = screen.getByText('Signal report').closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  test('reports the macro on click', () => {
    const onPick = vi.fn();
    render(<MacroChip macro={signal} onPick={onPick} />);
    fireEvent.click(screen.getByText('Signal report'));
    expect(onPick).toHaveBeenCalledWith(signal);
  });
});
