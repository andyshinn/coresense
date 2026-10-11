import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// My radio's rail: per-contact telemetry flags (DECISIONS B16) — on-radio
// chat contacts only, flagged first, search, columns live only under
// "Per contact", optimistic writes, and the meshcore-ts 0.9 gate.

const { api, notify } = vi.hoisted(() => ({
  api: { putContactTelemetryPerms: vi.fn(async () => ({ ok: true })) },
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/renderer/lib/notify', () => ({ notify }));
vi.mock('../../../src/renderer/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../src/renderer/lib/api')>()),
  api,
}));

import { ApiError } from '../../../src/renderer/lib/api';
import { useStore } from '../../../src/renderer/lib/store';
import { useFlagRows } from '../../../src/renderer/panels/my-radio/flags';
import { markLibUnsupported, resetLibSupport } from '../../../src/renderer/panels/my-radio/libSupport';
import { TelemetryFlagsRail } from '../../../src/renderer/panels/my-radio/TelemetryFlagsRail';
import { railTitle } from '../../../src/renderer/shell/rightrail/helpers';
import { type RailData, sectionsFor } from '../../../src/renderer/shell/rightrail/sectionsFor';
import type { Contact } from '../../../src/shared/types';
import { chat, client, seedRadio } from './helpers';

const ann = chat('01', 'Ann');
const bo = chat('02', 'Bo', { base: false, loc: false, env: true });
const cy = chat('03', 'Cy');
const relay: Contact = { ...chat('04', 'Relay'), kind: 'repeater', telemetryPerms: { base: true, loc: true, env: true } };

const box = (name: string, group: string) => screen.getByLabelText(`${name}: ${group}`) as HTMLButtonElement;
const names = () => Array.from(document.querySelectorAll('li[data-contact-key] .truncate')).map((n) => n.textContent);

beforeEach(() => {
  resetLibSupport();
  api.putContactTelemetryPerms.mockReset();
  api.putContactTelemetryPerms.mockResolvedValue({ ok: true });
  for (const fn of Object.values(notify)) fn.mockClear();
});

describe('TelemetryFlagsRail', () => {
  it('lists the radio’s chat contacts, flagged first then by name', () => {
    seedRadio({ contacts: [cy, relay, ann, bo] });
    render(<TelemetryFlagsRail client={client} />);
    expect(names()).toEqual(['Bo', 'Ann', 'Cy']);
    expect(screen.getByText('020202…0202')).toBeTruthy();
  });

  it('falls back to the stored flags byte when the contact carries none (older library)', () => {
    seedRadio({ contacts: [ann] });
    useStore.setState({
      discovered: [
        {
          key: ann.key,
          publicKeyHex: ann.publicKeyHex,
          name: 'Ann',
          kind: 'chat',
          firstHeardMs: 0,
          onRadio: true,
          favourite: false,
          blocked: false,
          telemetryPerms: { base: false, loc: true, env: false },
        },
      ],
    });
    render(<TelemetryFlagsRail client={client} />);
    expect(box('Ann', 'Location').getAttribute('aria-checked')).toBe('true');
  });

  it('filters by name or key prefix', () => {
    seedRadio({ contacts: [ann, bo, cy] });
    render(<TelemetryFlagsRail client={client} />);
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'an' } });
    expect(names()).toEqual(['Ann']);
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: '0303' } });
    expect(names()).toEqual(['Cy']);
    fireEvent.change(screen.getByLabelText('Search contacts'), { target: { value: 'zed' } });
    expect(screen.getByText('No contacts match “zed”.')).toBeTruthy();
  });

  it('enables only the columns whose mode is "Per contact", and says why the rest are greyed', () => {
    seedRadio({ contacts: [ann], policy: { base: 2, loc: 1, env: 0 } });
    render(<TelemetryFlagsRail client={client} />);
    expect(box('Ann', 'Base').disabled).toBe(true);
    expect(box('Ann', 'Location').disabled).toBe(false);
    expect(box('Ann', 'Environment').disabled).toBe(true);
    expect(screen.getByText(/^Base and Environment are greyed: /)).toBeTruthy();
  });

  it('writes the contact’s three flags, showing the change at once', async () => {
    seedRadio({ contacts: [bo] });
    render(<TelemetryFlagsRail client={client} />);
    await act(async () => {
      fireEvent.click(box('Bo', 'Location'));
    });
    expect(api.putContactTelemetryPerms).toHaveBeenCalledWith(client, bo.key, { base: false, loc: true, env: true });
    expect(box('Bo', 'Location').getAttribute('aria-checked')).toBe('true');
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('rolls back and toasts when the write fails', async () => {
    seedRadio({ contacts: [bo] });
    api.putContactTelemetryPerms.mockRejectedValueOnce(new Error('radio rejected the contact update or timed out'));
    render(<TelemetryFlagsRail client={client} />);
    await act(async () => {
      fireEvent.click(box('Bo', 'Environment'));
    });
    expect(box('Bo', 'Environment').getAttribute('aria-checked')).toBe('true');
    expect(notify.error.mock.calls[0][0]).toBe(
      'Telemetry flags save failed for Bo: radio rejected the contact update or timed out',
    );
  });

  it('turns a 501 into the disabled "Needs meshcore-ts 0.9" state', async () => {
    seedRadio({ contacts: [ann] });
    api.putContactTelemetryPerms.mockRejectedValueOnce(new ApiError('setContactTelemetryPerms', 501, 'lib_unsupported'));
    render(<TelemetryFlagsRail client={client} />);
    await act(async () => {
      fireEvent.click(box('Ann', 'Location'));
    });
    expect(screen.getByTestId('flags-unsupported').textContent).toBe('Needs meshcore-ts 0.9');
    expect(box('Ann', 'Location').disabled).toBe(true);
    expect(box('Ann', 'Location').getAttribute('aria-checked')).toBe('false');
    expect(notify.error.mock.calls[0][0]).toBe('Telemetry flags save failed: needs meshcore-ts 0.9');
  });

  it('starts disabled when the library is already known to be too old, or the radio is away', () => {
    seedRadio({ contacts: [ann] });
    markLibUnsupported();
    const { unmount } = render(<TelemetryFlagsRail client={client} />);
    expect(box('Ann', 'Location').disabled).toBe(true);
    expect(screen.getByText(/Editing flags needs meshcore-ts 0\.9/)).toBeTruthy();
    unmount();

    resetLibSupport();
    seedRadio({ contacts: [ann], connected: false });
    render(<TelemetryFlagsRail client={client} />);
    expect(box('Ann', 'Location').disabled).toBe(true);
  });

  it('is the rail for tool:myradio', () => {
    const data: RailData = {
      channel: null,
      contact: null,
      selectedMessage: null,
      mentionedContact: null,
      repeaters: [],
      repeaterAdminActiveTab: null,
      cardPublicKeyHex: null,
    };
    const sections = sectionsFor('tool:myradio', data, { clearMentionedContact: () => {}, client });
    expect(sections.map((s) => s.id)).toEqual(['rail.myradio.flags']);
    expect(sections[0].label).toBe('Telemetry flags per contact');
    expect(railTitle('tool:myradio')).toBe('My radio');
  });
});

describe('useFlagRows', () => {
  it('keeps the same rows across a re-broadcast that changes no flag, and rebuilds on a real change', () => {
    seedRadio({ contacts: [chat('01', 'Ann', { base: true, loc: false, env: false }), chat('02', 'Bo')] });
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useFlagRows();
    });
    const first = result.current;
    expect(first.map((r) => r.name)).toEqual(['Ann', 'Bo']);

    // contacts and discovered are re-sent (new arrays, same content) on a busy mesh.
    act(() => useStore.setState({ contacts: [...useStore.getState().contacts], discovered: [] }));
    expect(result.current).toBe(first);
    expect(renders).toBe(1);

    act(() => useStore.setState({ contacts: [chat('01', 'Ann'), chat('02', 'Bo', { base: true, loc: true, env: true })] }));
    expect(result.current).not.toBe(first);
    expect(result.current.map((r) => r.name)).toEqual(['Bo', 'Ann']);
  });
});
