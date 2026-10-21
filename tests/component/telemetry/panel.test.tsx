import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedRequestDto, TelemetryInFlight } from '../../../src/shared/telemetry/types';

const { notify, api } = vi.hoisted(() => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
  api: {
    listTelemetry: vi.fn(async (): Promise<SavedRequestDto[]> => []),
    requestTelemetry: vi.fn(),
    deleteTelemetryRequest: vi.fn(async () => ({ ok: true })),
    clearTelemetry: vi.fn(async () => ({ ok: true })),
    resetContactPath: vi.fn(async () => ({ ok: true })),
    putTelemetryRetention: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock('../../../src/renderer/lib/notify', () => ({ notify }));
vi.mock('../../../src/renderer/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../src/renderer/lib/api')>()),
  api,
}));

import { TelemetryPanel } from '../../../src/renderer/features/telemetry/TelemetryPanel';
import { useStore } from '../../../src/renderer/lib/store';
import { RADIO_BUSY_HINT } from '../../../src/renderer/lib/telemetry';
import { fmtDateTime } from '../../../src/renderer/lib/time';
import { dto, PLAN_FIXTURE, T1000E_REMOTE, use24h } from './helpers';

const PK = 'aa'.repeat(32);
const KEY = `c:${PK}`;
const client = { baseUrl: 'http://x', apiKey: 'k' };

// Relative to the real clock: the list, ages and the older-request rule read Date.now().
const NOW = Date.now();
const NEWEST = dto('r1', NOW - 12_000, PLAN_FIXTURE);
// Two hours earlier, before the ch 3 power monitor: battery 4.22 V, ch 2 env.
const EARLIER = dto(
  'r2',
  NOW - 2 * 3_600_000,
  '01 74 01 A6 01 88 04 9C 22 F1 15 2A 00 41 C8 02 67 01 17 02 68 62 02 73 27 9D 02 79 00 9C',
  { roundTripMs: 2100 },
);
const TIMEOUT = dto('r3', NOW - 3 * 3_600_000, null, { outcome: 'timeout', roundTripMs: 15_000, hops: 2 });

function seed(list: SavedRequestDto[], over: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    telemetryByNode: { [PK]: list },
    telemetryLoaded: { [PK]: true },
    telemetryInFlight: [],
    telemetrySelectedId: {},
    telemetryCompare: {},
    telemetryFetchLedger: {},
    ...over,
  });
}

const flight = (nodeKey: string, source: TelemetryInFlight['source'] = 'repeater'): TelemetryInFlight => ({
  nodeKey,
  source,
  startedAt: Date.now() - 4_000,
  deadlineAt: Date.now() + 11_000,
});

const requestButton = () =>
  (screen.queryByText('Request telemetry') ?? screen.getByText('Requesting…')).closest('button') as HTMLButtonElement;
const select = (id: string) => fireEvent.click(document.querySelector(`[data-request-id="${id}"]`) as HTMLElement);

beforeEach(() => {
  use24h();
  for (const fn of [...Object.values(api), ...Object.values(notify)]) fn.mockClear();
});

afterEach(() => vi.useRealTimers());

describe('TelemetryPanel — states', () => {
  it('loads the saved requests on mount, with skeleton rows meanwhile', async () => {
    useStore.setState({ telemetryByNode: {}, telemetryLoaded: {}, telemetryInFlight: [], telemetrySelectedId: {} });
    api.listTelemetry.mockResolvedValueOnce([NEWEST]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByLabelText('Loading saved requests')).toBeTruthy();
    expect(api.listTelemetry).toHaveBeenCalledWith(client, PK);
    await waitFor(() => expect(screen.getAllByTestId('telemetry-tile').length).toBe(9));
  });

  it('shows the empty state, with the login hint and a Log in shortcut for a repeater with no session', () => {
    seed([]);
    const onLogIn = vi.fn();
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} needsLogin onLogIn={onLogIn} />);
    expect(screen.getByText('No telemetry yet. Click Request telemetry to ask this repeater.')).toBeTruthy();
    expect(screen.getByTestId('telemetry-request-hint').textContent).toBe(
      'Repeaters and sensors reply only to logged-in clients',
    );
    fireEvent.click(screen.getByText('Log in'));
    expect(onLogIn).toHaveBeenCalledTimes(1);
  });

  it('names the companion action "Read telemetry" and the target "your radio"', () => {
    seed([]);
    render(<TelemetryPanel source="companion" nodeKey={KEY} client={client} />);
    expect(screen.getByText('No telemetry yet. Click Read telemetry to ask your radio.')).toBeTruthy();
    expect(screen.getByText('Read telemetry').closest('button')?.disabled).toBe(false);
  });

  it('shows the selected request: full timestamp, meta line, grants, a card per channel, the inspector', () => {
    seed([NEWEST, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText(fmtDateTime(NEWEST.requestedAt, '24h'))).toBeTruthy();
    expect(screen.getByText(/1\.8 s round trip · 0 hops · 42 bytes · 9 readings$/)).toBeTruthy();
    expect(screen.getByText('Granted as admin')).toBeTruthy();
    expect(screen.getByLabelText('Channel 1')).toBeTruthy();
    expect(screen.getByLabelText('Channel 2')).toBeTruthy();
    expect(screen.getByLabelText('Channel 3')).toBeTruthy();
    expect(screen.getByText('Decoded CayenneLPP')).toBeTruthy();
    // The newest, seconds old: no older-request notice.
    expect(screen.queryByText('Older request')).toBeNull();
  });

  it('gives each reading its previous value from the earlier request, and none to a new sensor', () => {
    seed([NEWEST, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const deltas = screen.getAllByTestId('tile-delta').map((d) => d.textContent ?? '');
    expect(deltas.some((t) => t.includes('+0.03 V') && t.includes('was 4.22 V at'))).toBe(true);
    expect(deltas.some((t) => t.includes('was 27.9 °C at'))).toBe(true);
    // Ch 3 (bus voltage, current, power) first appears in the newest request.
    const ch3 = screen.getByLabelText('Channel 3');
    expect(ch3.querySelectorAll('[data-testid="tile-delta"]')).toHaveLength(0);
  });

  it('marks an older request with the age chip and the "request for current values" copy', () => {
    seed([NEWEST, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    select('r2');
    expect(screen.getByText('Older request')).toBeTruthy();
    expect(screen.getByText('2 h old')).toBeTruthy();
    expect(screen.getByText(/^Showing the saved request from .*\. Request telemetry for current values\.$/)).toBeTruthy();
  });

  it('treats the newest request as older once it is over an hour old', () => {
    seed([EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('Older request')).toBeTruthy();
  });

  it('explains a guest reply and offers "Log in as admin"', () => {
    seed([dto('g', NOW - 5_000, '01 74 01 A9 01 67 01 36', { aclRole: 'guest', permsGranted: 1 })]);
    const onLogIn = vi.fn();
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} onLogIn={onLogIn} />);
    expect(screen.getByText('Granted as guest')).toBeTruthy();
    expect(screen.getByText('Base only')).toBeTruthy();
    fireEvent.click(screen.getByText('Log in as admin'));
    expect(onLogIn).toHaveBeenCalledTimes(1);
  });

  it('does not call a guest-role sensor reply base only: a sensor answers guests in full (perms 0x07)', () => {
    seed([dto('s', NOW - 5_000, PLAN_FIXTURE, { aclRole: 'guest', permsGranted: 7 })]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} onLogIn={vi.fn()} />);
    expect(screen.getByText('Granted as guest')).toBeTruthy();
    expect(screen.queryByText('Base only')).toBeNull();
    expect(screen.queryByText('Log in as admin')).toBeNull();
    expect(screen.getAllByTestId('telemetry-tile').length).toBeGreaterThan(1);
  });

  it('notes a full reply with no sensors, wording it from ch 1', () => {
    seed([dto('b', NOW - 5_000, '01 74 01 A9')]);
    const { unmount } = render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('Battery only. This node reported no environment sensors.')).toBeTruthy();
    unmount();

    // Ch 1 also carries the MCU temperature: not "battery only".
    seed([dto('m', NOW - 5_000, '01 74 01 A9 01 67 01 36')]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('This node reported no environment sensors.')).toBeTruthy();
  });

  it('doesn’t call a T1000-E sensorless: its luminosity and temperature sit on ch 1', () => {
    seed([dto('t', NOW - 5_000, T1000E_REMOTE)]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('Luminosity')).toBeTruthy();
    expect(screen.queryByText('No sensors')).toBeNull();
    // Its ch 1 chip names every permission the channel needs.
    expect(screen.getByText('Base · Location · Environment')).toBeTruthy();
  });

  it('names a companion read as a read throughout: loading, failure, log and actions', () => {
    const failed = dto('f', NOW - 5_000, null, {
      source: 'companion',
      outcome: 'timeout',
      roundTripMs: 5_000,
      route: 'local',
      hops: null,
      aclRole: null,
    });
    seed([failed], { telemetryInFlight: [flight(PK, 'companion')] });
    render(<TelemetryPanel source="companion" nodeKey={KEY} client={client} />);
    expect(screen.getByLabelText('Reading telemetry')).toBeTruthy();
    expect(screen.getByText('Reads')).toBeTruthy();
    select('f');
    expect(screen.getByText('Read failed')).toBeTruthy();
    expect(screen.getByText('Telemetry read failed: timeout')).toBeTruthy();
    expect(screen.getByLabelText('Delete this read')).toBeTruthy();
    expect(screen.getByText('Clear saved reads…')).toBeTruthy();
  });

  it('sets the heading level it is given', () => {
    seed([NEWEST]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} headingLevel={4} />);
    expect(screen.getByText(fmtDateTime(NEWEST.requestedAt, '24h')).tagName).toBe('H4');
  });
});

describe('TelemetryPanel — request button', () => {
  it('requests, then toasts the saved outcome', async () => {
    seed([NEWEST]);
    api.requestTelemetry.mockResolvedValueOnce(dto('r9', NOW, PLAN_FIXTURE));
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    fireEvent.click(requestButton());
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Telemetry saved'));
    expect(api.requestTelemetry).toHaveBeenCalledWith(client, KEY);
  });

  it('stays enabled with no session, with the login hint', () => {
    seed([NEWEST]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} needsLogin />);
    expect(requestButton().disabled).toBe(false);
    expect(screen.getByText('Repeaters and sensors reply only to logged-in clients')).toBeTruthy();
  });

  it('is disabled while this node is in flight, and shows the loading card', () => {
    seed([NEWEST], { telemetryInFlight: [flight(PK)] });
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('Requesting…').closest('button')?.disabled).toBe(true);
    expect(screen.getByTestId('telemetry-waiting').textContent).toBe('waiting for reply · 4 s · timeout at 15 s');
    // The loading card takes the right side until a request is picked.
    expect(screen.queryByText('Decoded CayenneLPP')).toBeNull();
    select('r1');
    expect(screen.getByText('Decoded CayenneLPP')).toBeTruthy();
  });

  it('is disabled with the busy hint while another node holds the radio', () => {
    seed([NEWEST], { telemetryInFlight: [flight('bb'.repeat(32))] });
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const button = requestButton();
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(RADIO_BUSY_HINT);
    expect(screen.getByTestId('telemetry-request-hint').textContent).toBe(RADIO_BUSY_HINT);
    act(() => useStore.getState().applyTelemetryInFlight([]));
    expect(requestButton().disabled).toBe(false);
  });

  it('lets a companion self read through while a mesh request holds the radio', () => {
    seed([], { telemetryInFlight: [flight('bb'.repeat(32))] });
    render(<TelemetryPanel source="companion" nodeKey={KEY} client={client} />);
    expect(screen.getByText('Read telemetry').closest('button')?.disabled).toBe(false);
  });

  it('is disabled without a server connection', () => {
    seed([NEWEST]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={null} />);
    expect(requestButton().disabled).toBe(true);
  });

  it('sends one request for a double click, and toasts once', async () => {
    seed([NEWEST]);
    let resolve!: (r: SavedRequestDto) => void;
    api.requestTelemetry.mockReturnValueOnce(new Promise<SavedRequestDto>((r) => (resolve = r)));
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const button = requestButton();
    fireEvent.click(button);
    // Before main's in-flight push lands the button already reads as pending.
    expect(requestButton().textContent).toBe('Requesting…');
    expect(requestButton().disabled).toBe(true);
    fireEvent.click(button);
    expect(api.requestTelemetry).toHaveBeenCalledTimes(1);
    await act(async () => resolve(dto('r9', NOW, PLAN_FIXTURE)));
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(requestButton().disabled).toBe(false);
  });

  it('reports a request that could not be sent ("<Action> failed: <reason>")', async () => {
    seed([NEWEST]);
    api.requestTelemetry.mockRejectedValueOnce(Object.assign(new Error('409'), { code: 'radio_busy' }));
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    fireEvent.click(requestButton());
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Telemetry request failed: radio busy', expect.any(Error)),
    );
  });
});

describe('TelemetryPanel — failed request', () => {
  it('offers Try again, Reset to flood (stored direct path) and Log in (no session)', async () => {
    seed([TIMEOUT]);
    api.requestTelemetry.mockResolvedValueOnce(dto('r9', NOW, PLAN_FIXTURE));
    const onLogIn = vi.fn();
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} needsLogin onLogIn={onLogIn} canResetPath />);
    expect(screen.getByText('Telemetry request failed: timeout')).toBeTruthy();
    expect(screen.getByText('No reply in 15 s over a 2-hop path. Try again, or reset the path to flood.')).toBeTruthy();

    fireEvent.click(screen.getByText('Reset to flood'));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Reset to flood'));
    expect(api.resetContactPath).toHaveBeenCalledWith(client, KEY);

    fireEvent.click(screen.getByText('Log in'));
    expect(onLogIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(api.requestTelemetry).toHaveBeenCalledWith(client, KEY));
  });

  it('offers Log in only for a timeout: an error isn’t the ACL dropping the request', () => {
    seed([dto('e', NOW - 5_000, null, { outcome: 'error', error: 'disconnected' })]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} needsLogin onLogIn={() => {}} />);
    expect(screen.getByText('Telemetry request failed: disconnected')).toBeTruthy();
    expect(screen.queryByText('Log in')).toBeNull();
    expect(screen.queryByText('Repeaters and sensors reply only to logged-in clients.')).toBeNull();
  });

  it('hides Reset to flood without a stored path, and Log in with a session', () => {
    seed([TIMEOUT]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} onLogIn={() => {}} />);
    expect(screen.queryByText('Reset to flood')).toBeNull();
    expect(screen.queryByText('Log in')).toBeNull();
    // Nothing to compare a failure with.
    expect(screen.getByText('Compare with previous').closest('button')?.disabled).toBe(true);
  });

  it('blocks Try again while another node holds the radio', () => {
    seed([TIMEOUT], { telemetryInFlight: [flight('bb'.repeat(32))] });
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const retry = screen.getByText('Try again').closest('button') as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toBe(RADIO_BUSY_HINT);
  });

  it('reports a failed reset', async () => {
    seed([TIMEOUT]);
    api.resetContactPath.mockRejectedValueOnce(new Error('offline'));
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} canResetPath />);
    fireEvent.click(screen.getByText('Reset to flood'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Reset to flood failed: offline', expect.any(Error)));
  });
});

describe('TelemetryPanel — delete and clear', () => {
  it('deletes the selected request without confirming, then shows the next newest', async () => {
    seed([NEWEST, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    fireEvent.click(screen.getByLabelText('Delete this request'));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Request deleted'));
    expect(api.deleteTelemetryRequest).toHaveBeenCalledWith(client, 'r1');
    expect(screen.getByText(fmtDateTime(EARLIER.requestedAt, '24h'))).toBeTruthy();
    expect(screen.getByText('1 saved')).toBeTruthy();
  });

  it('reports a failed delete and keeps the request', async () => {
    seed([NEWEST]);
    api.deleteTelemetryRequest.mockRejectedValueOnce(new Error('gone'));
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    fireEvent.click(screen.getByLabelText('Delete this request'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Deleting request failed: gone', expect.any(Error)));
    expect(screen.getByText('1 saved')).toBeTruthy();
  });

  it('clears every saved request after confirming', async () => {
    seed([NEWEST, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} nodeName="Hilltop" />);
    fireEvent.click(screen.getByText('Clear saved requests…'));
    expect(screen.getByText(/Delete all 2 saved telemetry requests for Hilltop\?/)).toBeTruthy();
    expect(api.clearTelemetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Clear'));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Saved requests cleared'));
    expect(api.clearTelemetry).toHaveBeenCalledWith(client, KEY);
    expect(screen.getByText('0 saved')).toBeTruthy();
  });

  it('cancels the clear dialog without deleting anything', () => {
    seed([NEWEST]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    fireEvent.click(screen.getByText('Clear saved requests…'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(api.clearTelemetry).not.toHaveBeenCalled();
  });
});

describe('TelemetryPanel — footer', () => {
  it('shows the retention and enters compare mode seeded with the selection and its previous reply', () => {
    seed([NEWEST, TIMEOUT, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('keeps the last 50 per node')).toBeTruthy();
    fireEvent.click(screen.getByText('Compare'));
    expect(useStore.getState().telemetryCompare[PK]).toEqual(['r1', 'r2']);
    expect(screen.getByText('Compare 2 requests')).toBeTruthy();
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(useStore.getState().telemetryCompare[PK]).toBeUndefined();
    expect(screen.getByText('Decoded CayenneLPP')).toBeTruthy();
  });

  it('"Compare with previous" pairs the request with the previous ok one, skipping a failure', () => {
    seed([NEWEST, TIMEOUT, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    fireEvent.click(screen.getByText('Compare with previous'));
    expect(useStore.getState().telemetryCompare[PK]).toEqual(['r1', 'r2']);
  });

  it('keeps keyboard focus when the control that switched modes unmounts', () => {
    seed([NEWEST, EARLIER]);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const withPrevious = screen.getByText('Compare with previous').closest('button') as HTMLButtonElement;
    withPrevious.focus();
    fireEvent.click(withPrevious);
    expect(document.activeElement?.textContent).toBe('Done');
    fireEvent.click(document.activeElement as HTMLButtonElement);
    expect(document.activeElement?.textContent).toBe('Compare');
  });
});
