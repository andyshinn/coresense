import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedRequestDto } from '../../../src/shared/telemetry/types';

// My radio (tool:myradio): the companion's own telemetry view, the read
// button and caption, the saved-reads toggle, and the unsupported-library
// and GPS-off states (DECISIONS: My radio, B15, B23).

const { api, notify } = vi.hoisted(() => ({
  api: {
    listTelemetry: vi.fn(async (): Promise<SavedRequestDto[]> => []),
    requestTelemetry: vi.fn(),
    getSensorSettings: vi.fn(async (): Promise<Record<string, string>> => ({ gps: '1' })),
    putSensorSetting: vi.fn(async () => ({ ok: true })),
    putTelemetryPolicy: vi.fn(async () => ({ ok: true })),
    deleteTelemetryRequest: vi.fn(async () => ({ ok: true })),
    clearTelemetry: vi.fn(async () => ({ ok: true })),
    resetContactPath: vi.fn(async () => ({ ok: true })),
    putTelemetryRetention: vi.fn(async () => ({ ok: true })),
  },
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../src/renderer/lib/notify', () => ({ notify }));
vi.mock('../../../src/renderer/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../src/renderer/lib/api')>()),
  api,
}));

import { ApiError } from '../../../src/renderer/lib/api';
import { useStore } from '../../../src/renderer/lib/store';
import { resetLibSupport } from '../../../src/renderer/panels/my-radio/libSupport';
import { MyRadioPanel } from '../../../src/renderer/panels/my-radio/MyRadioPanel';
import { client, OWN, SELF_GPS_HEX, seedRadio, selfRead } from './helpers';

const NOW = Date.now();
const unsupported = () => new ApiError('requestSelfTelemetry needs a newer meshcore-ts', 501, 'lib_unsupported');
const readButton = () =>
  (screen.queryByText('Read telemetry') ?? screen.getByText('Reading…')).closest('button') as HTMLButtonElement;
const clock = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** Render and let the mount-time sensor-settings read settle. */
async function mount() {
  const view = render(<MyRadioPanel client={client} />);
  await waitFor(() => expect(api.getSensorSettings).toHaveBeenCalled());
  await act(async () => {});
  return view;
}

beforeEach(() => {
  resetLibSupport();
  for (const fn of [...Object.values(api), ...Object.values(notify)]) fn.mockClear();
  api.getSensorSettings.mockResolvedValue({ gps: '1' });
});

describe('MyRadioPanel', () => {
  it('asks for a radio when there is no owner identity', () => {
    seedRadio({ owner: false, connected: false });
    render(<MyRadioPanel client={client} />);
    expect(screen.getByText('My radio')).toBeTruthy();
    expect(screen.getByText(/No radio connected/)).toBeTruthy();
    fireEvent.click(screen.getByText('Connect a radio'));
    expect(useStore.getState().ui.activeKey).toBe('tool:bleconnect');
  });

  it('shows the latest read with the link caption, and hides the log until "N saved reads" is clicked', async () => {
    const newest = selfRead('s1', NOW - 5_000);
    seedRadio({ reads: [newest, selfRead('s2', NOW - 3_600_000)] });
    await mount();

    expect(screen.getByText('egrme.sh Hand · companion · ababab')).toBeTruthy();
    expect(screen.getByText(`read over BLE at ${clock(newest.requestedAt)} · no airtime used`)).toBeTruthy();
    expect(screen.getByLabelText('Channel 1')).toBeTruthy();
    expect(screen.getByLabelText('Channel 2')).toBeTruthy();
    // No grants on a self read.
    expect(screen.queryByText(/Granted as/)).toBeNull();
    // The policy and sensor cards sit under the reading.
    expect(screen.getByLabelText('Who can read my telemetry')).toBeTruthy();
    expect(screen.getByLabelText('Sensor settings')).toBeTruthy();

    expect(screen.queryByLabelText('Telemetry reads')).toBeNull();
    const toggle = screen.getByText('2 saved reads');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Telemetry reads')).toBeTruthy();
    // The read button stays in the action row, not duplicated above the log.
    expect(screen.getAllByText('Read telemetry')).toHaveLength(1);
    fireEvent.click(screen.getByText('2 saved reads'));
    expect(screen.queryByLabelText('Telemetry reads')).toBeNull();
  });

  it('says the last read failed rather than when it was read', async () => {
    const failed = selfRead('s2', NOW - 5_000, null, { outcome: 'timeout', roundTripMs: 5_000 });
    seedRadio({ reads: [failed, selfRead('s1', NOW - 60_000)] });
    await mount();
    expect(screen.getByText(`last read failed at ${clock(failed.requestedAt)}`)).toBeTruthy();
    expect(screen.queryByText(/^read over BLE at/)).toBeNull();
    expect(screen.getByText('Read failed')).toBeTruthy();
    expect(screen.getByText('Telemetry read failed: timeout')).toBeTruthy();
  });

  it('treats a 0,0 position as unset: no distance from it', async () => {
    seedRadio({ reads: [selfRead('s1', NOW - 5_000, SELF_GPS_HEX)] });
    useStore.setState({ deviceIdentity: { ...useStore.getState().deviceIdentity, lat: 0, lon: 0 } });
    await mount();
    expect(screen.getByText('View on map')).toBeTruthy();
    expect(screen.queryByText(/from advertised/)).toBeNull();
  });

  it('nests the read’s heading under "My telemetry"', async () => {
    const newest = selfRead('s1', NOW - 5_000);
    seedRadio({ reads: [newest] });
    await mount();
    expect(screen.getByText('My telemetry').tagName).toBe('H3');
    expect(document.querySelector('[aria-label="Selected read"] h4')).toBeTruthy();
  });

  it('names USB when the radio is on a serial link', async () => {
    seedRadio({ reads: [selfRead('s1', NOW - 5_000)] });
    useStore.setState({
      packets: [
        {
          id: 'p1',
          timestamp: NOW,
          transportType: 'serial',
          kind: 'companion',
          hex: '',
          bytes: [],
          payloadHex: '',
          payloadBytes: [],
        },
      ],
    });
    await mount();
    expect(screen.getByText(/^read over USB at /)).toBeTruthy();
  });

  it('reads the radio with its own key and toasts the saved outcome', async () => {
    seedRadio();
    api.requestTelemetry.mockResolvedValueOnce(selfRead('s9', NOW));
    await mount();
    expect(screen.getByText('No telemetry yet. Click Read telemetry to ask your radio.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(readButton());
    });
    expect(api.requestTelemetry).toHaveBeenCalledWith(client, OWN);
    expect(notify.success).toHaveBeenCalledWith('Telemetry saved');
  });

  it('turns a 501 on read into the unsupported state, without the generic failure toast', async () => {
    seedRadio();
    // A library that has custom vars but not self read would still be caught by the read's own 501.
    api.requestTelemetry.mockRejectedValueOnce(unsupported());
    await mount();
    await act(async () => {
      fireEvent.click(readButton());
    });
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error.mock.calls[0][0]).toBe('Telemetry read failed: needs meshcore-ts 0.9');
    expect(screen.getByTestId('myradio-unsupported').textContent).toContain('needs meshcore-ts 0.9');
    expect(readButton().disabled).toBe(true);
    expect(readButton().title).toBe('Needs meshcore-ts 0.9');
  });

  it('knows the library is too old from the sensor-settings read on mount, before any click', async () => {
    seedRadio();
    api.getSensorSettings.mockRejectedValueOnce(unsupported());
    await mount();
    expect(screen.getByTestId('myradio-unsupported')).toBeTruthy();
    expect(readButton().disabled).toBe(true);
    expect(screen.getAllByText('Needs meshcore-ts 0.9').length).toBeGreaterThan(0);
  });

  it('disables reading while disconnected, keeping the saved reads', async () => {
    seedRadio({ reads: [selfRead('s1', NOW - 60_000)], connected: false });
    render(<MyRadioPanel client={client} />);
    expect(readButton().disabled).toBe(true);
    expect(screen.getByText('Connect your radio to read it')).toBeTruthy();
    expect(screen.getByLabelText('Channel 1')).toBeTruthy();
    expect(api.getSensorSettings).not.toHaveBeenCalled();
  });

  it('adds the GPS-off tile to ch 1 when the radio has a GPS switched off, linking to the switch', async () => {
    seedRadio({ reads: [selfRead('s1', NOW - 5_000)] });
    api.getSensorSettings.mockResolvedValue({ gps: '0' });
    // setup.ts stubs scrollIntoView (jsdom has none).
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    await mount();
    const tile = screen.getByTestId('gps-off-tile');
    expect(screen.getByLabelText('Channel 1').contains(tile)).toBe(true);
    expect(tile.textContent).toContain('GPS is off on this radio.');
    fireEvent.click(screen.getByText('Sensor settings', { selector: 'button' }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('myradio-gps-switch');
    scrollIntoView.mockRestore();
  });

  it('shows no GPS-off tile when GPS is on, absent, or the read already has a fix', async () => {
    seedRadio({ reads: [selfRead('s1', NOW - 5_000)] });
    await mount();
    expect(screen.queryByTestId('gps-off-tile')).toBeNull();

    api.getSensorSettings.mockResolvedValue({});
    const { unmount } = await mount();
    expect(screen.queryAllByTestId('gps-off-tile')).toHaveLength(0);
    unmount();

    seedRadio({ reads: [selfRead('s2', NOW - 5_000, SELF_GPS_HEX)] });
    api.getSensorSettings.mockResolvedValue({ gps: '0' });
    await mount();
    expect(screen.queryAllByTestId('gps-off-tile')).toHaveLength(0);
  });
});
