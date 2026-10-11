import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// My radio's "Who can read my telemetry" (immediate partial writes, one at a
// time, shown at once and dropped if the radio refuses) and "Sensor settings" (GPS only when reported,
// write-only interval, per-field saves so a refused interval is a partial
// save — DECISIONS B15).

const { api, notify } = vi.hoisted(() => ({
  api: {
    getSensorSettings: vi.fn(async (): Promise<Record<string, string>> => ({ gps: '1' })),
    putSensorSetting: vi.fn(async () => ({ ok: true })),
    putTelemetryPolicy: vi.fn(async () => ({ ok: true })),
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
import { PolicyCard } from '../../../src/renderer/panels/my-radio/PolicyCard';
import { SensorSettingsCard } from '../../../src/renderer/panels/my-radio/SensorSettings';
import { useSensorSettings } from '../../../src/renderer/panels/my-radio/useSensorSettings';
import { chat, client, seedRadio } from './helpers';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The segmented control for one policy row ("Base", "Location", "Environment"). */
const seg = (label: string) => document.querySelector(`[role="radiogroup"][aria-label="${label}"]`) as HTMLElement;
const option = (label: string, mode: string) => within(seg(label)).getByText(mode).closest('button') as HTMLElement;
const isOn = (label: string, mode: string) => option(label, mode).getAttribute('data-state') === 'on';

beforeEach(() => {
  resetLibSupport();
  for (const fn of [...Object.values(api), ...Object.values(notify)]) fn.mockReset();
  api.getSensorSettings.mockResolvedValue({ gps: '1' });
  api.putSensorSetting.mockResolvedValue({ ok: true });
  api.putTelemetryPolicy.mockResolvedValue({ ok: true });
});

describe('PolicyCard', () => {
  it('shows the radio’s modes with the design’s copy', () => {
    seedRadio({ policy: { base: 2, loc: 1, env: 0 } });
    render(<PolicyCard client={client} connected />);
    expect(screen.getByText('saved on radio')).toBeTruthy();
    expect(screen.getByText('Battery voltage, MCU temperature.')).toBeTruthy();
    expect(isOn('Base', 'Everyone')).toBe(true);
    expect(isOn('Location', 'Per contact')).toBe(true);
    expect(isOn('Environment', 'Deny')).toBe(true);
  });

  it('writes only the changed field, showing it at once', async () => {
    seedRadio({ policy: { base: 2, loc: 1, env: 1 } });
    const put = deferred<{ ok: true }>();
    api.putTelemetryPolicy.mockReturnValueOnce(put.promise);
    render(<PolicyCard client={client} connected />);
    await act(async () => {
      fireEvent.click(option('Location', 'Everyone'));
    });
    expect(api.putTelemetryPolicy).toHaveBeenCalledWith(client, { loc: 2 });
    expect(isOn('Location', 'Everyone')).toBe(true);
    // The store keeps what the radio holds until it accepts.
    expect(useStore.getState().telemetryPolicy).toMatchObject({ base: 2, loc: 1, env: 1, multiAcks: 1 });
    await act(async () => put.resolve({ ok: true }));
    expect(useStore.getState().telemetryPolicy).toMatchObject({ base: 2, loc: 2, env: 1, multiAcks: 1 });
    expect(isOn('Location', 'Everyone')).toBe(true);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('sends overlapping changes to different fields one at a time, so neither undoes the other', async () => {
    // Main merges each patch onto the radio's last confirmed policy: two PUTs
    // in flight would each write the other's field back.
    seedRadio({ policy: { base: 2, loc: 1, env: 1 } });
    const first = deferred<{ ok: true }>();
    api.putTelemetryPolicy.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true });
    render(<PolicyCard client={client} connected />);
    await act(async () => {
      fireEvent.click(option('Base', 'Per contact'));
    });
    await act(async () => {
      fireEvent.click(option('Location', 'Everyone'));
    });
    expect(api.putTelemetryPolicy).toHaveBeenCalledTimes(1);
    expect(isOn('Base', 'Per contact')).toBe(true);
    expect(isOn('Location', 'Everyone')).toBe(true);

    await act(async () => first.resolve({ ok: true }));
    expect(api.putTelemetryPolicy).toHaveBeenCalledTimes(2);
    expect(api.putTelemetryPolicy).toHaveBeenLastCalledWith(client, { loc: 2 });
    expect(useStore.getState().telemetryPolicy).toMatchObject({ base: 1, loc: 2, env: 1 });
    expect(isOn('Base', 'Per contact')).toBe(true);
  });

  it('falls back to the radio’s value, not an earlier unconfirmed choice, when every write fails', async () => {
    seedRadio({ policy: { base: 2, loc: 1, env: 1 } });
    const a = deferred<{ ok: true }>();
    const b = deferred<{ ok: true }>();
    api.putTelemetryPolicy.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    render(<PolicyCard client={client} connected />);
    await act(async () => {
      fireEvent.click(option('Base', 'Per contact'));
    });
    await act(async () => {
      fireEvent.click(option('Base', 'Deny'));
    });
    await act(async () => a.reject(new Error('timeout')));
    expect(isOn('Base', 'Deny')).toBe(true);
    await act(async () => b.reject(new Error('timeout')));
    expect(isOn('Base', 'Everyone')).toBe(true);
    expect(useStore.getState().telemetryPolicy.base).toBe(2);
    expect(notify.error).toHaveBeenCalledTimes(2);
  });

  it('rolls back and toasts when the radio refuses', async () => {
    seedRadio({ policy: { base: 2, loc: 1, env: 1 } });
    api.putTelemetryPolicy.mockRejectedValueOnce(new Error('SET_OTHER_PARAMS rejected by radio'));
    render(<PolicyCard client={client} connected />);
    await act(async () => {
      fireEvent.click(option('Environment', 'Deny'));
    });
    expect(isOn('Environment', 'Per contact')).toBe(true);
    expect(useStore.getState().telemetryPolicy.env).toBe(1);
    expect(notify.error.mock.calls[0][0]).toBe('Telemetry policy save failed: SET_OTHER_PARAMS rejected by radio');
  });

  it('a stale failure doesn’t undo a newer choice for the same field', async () => {
    seedRadio({ policy: { base: 2, loc: 1, env: 1 } });
    const first = deferred<{ ok: true }>();
    api.putTelemetryPolicy.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true });
    render(<PolicyCard client={client} connected />);
    fireEvent.click(option('Base', 'Deny'));
    await act(async () => {
      fireEvent.click(option('Base', 'Per contact'));
    });
    await act(async () => first.reject(new Error('timeout')));
    expect(useStore.getState().telemetryPolicy.base).toBe(1);
    expect(notify.error).toHaveBeenCalledTimes(1);
  });

  it('is read-only while disconnected', () => {
    seedRadio({ connected: false });
    render(<PolicyCard client={client} connected={false} />);
    expect(screen.getByText('connect your radio to change')).toBeTruthy();
    expect((option('Base', 'Deny') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(option('Base', 'Deny'));
    expect(api.putTelemetryPolicy).not.toHaveBeenCalled();
  });

  it('counts the contacts each "Per contact" mode admits, and warns about Base on Deny', () => {
    seedRadio({
      policy: { base: 0, loc: 1, env: 1 },
      contacts: [
        chat('01', 'Ann', { base: true, loc: true, env: true }),
        chat('02', 'Bo', { base: false, loc: false, env: true }),
        chat('03', 'Cy'),
      ],
    });
    render(<PolicyCard client={client} connected />);
    expect(screen.getByText(/1 contact can read location, 2 can read environment\.$/)).toBeTruthy();
    expect(screen.getByText(/With Base on Deny the radio answers no one/)).toBeTruthy();
  });
});

/** The card with its hook, as My radio mounts them. */
function Sensors({ connected = true }: { connected?: boolean }) {
  const control = useSensorSettings(client, connected);
  return <SensorSettingsCard control={control} connected={connected} />;
}

async function mountSensors(connected = true) {
  render(<Sensors connected={connected} />);
  if (connected) await waitFor(() => expect(screen.queryByLabelText('Reading sensor settings')).toBeNull());
}

const gpsSwitch = () => document.getElementById('myradio-gps-switch') as HTMLButtonElement;
const intervalInput = () => screen.getByLabelText('GPS update interval') as HTMLInputElement;

describe('SensorSettingsCard', () => {
  it('shows the GPS switch and the last-set interval when the radio reports gps', async () => {
    seedRadio({ gpsIntervalSec: 600 });
    await mountSensors();
    expect(screen.getByText('1 setting reported by the radio')).toBeTruthy();
    expect(gpsSwitch().getAttribute('aria-checked')).toBe('true');
    expect(intervalInput().value).toBe('600');
    expect(screen.getByText('gps_interval · seconds · last set from CoreSense')).toBeTruthy();
  });

  it('says so when the radio has no GPS', async () => {
    seedRadio();
    api.getSensorSettings.mockResolvedValueOnce({});
    await mountSensors();
    expect(screen.getByText('No GPS detected on this radio.')).toBeTruthy();
    expect(screen.getByText('none reported by the radio')).toBeTruthy();
    expect(gpsSwitch()).toBeNull();
    expect(screen.queryByLabelText('GPS update interval')).toBeNull();
  });

  it('points at Settings › Position when the library can’t read sensor settings', async () => {
    seedRadio();
    api.getSensorSettings.mockRejectedValueOnce(new ApiError('requestCustomVars', 501, 'lib_unsupported'));
    await mountSensors();
    expect(screen.getByText('Needs meshcore-ts 0.9')).toBeTruthy();
    fireEvent.click(screen.getByText('Position settings'));
    expect(useStore.getState().ui.activeKey).toBe('tool:settings:position');
  });

  it('offers a retry after a failed read', async () => {
    seedRadio();
    api.getSensorSettings.mockRejectedValueOnce(new Error('no custom vars reply from the radio'));
    await mountSensors();
    expect(screen.getByText('Reading sensor settings failed: no custom vars reply from the radio')).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    await waitFor(() => expect(gpsSwitch()).toBeTruthy());
    expect(api.getSensorSettings).toHaveBeenCalledTimes(2);
  });

  it('asks the radio nothing while disconnected', async () => {
    seedRadio({ connected: false });
    await mountSensors(false);
    expect(screen.getByText('Connect your radio to see its sensor settings.')).toBeTruthy();
    expect(api.getSensorSettings).not.toHaveBeenCalled();
  });

  it('switches GPS at once, and restores it with a toast when the radio refuses', async () => {
    seedRadio();
    await mountSensors();
    await act(async () => {
      fireEvent.click(gpsSwitch());
    });
    expect(api.putSensorSetting).toHaveBeenCalledWith(client, 'gps', '0');
    expect(gpsSwitch().getAttribute('aria-checked')).toBe('false');

    api.putSensorSetting.mockRejectedValueOnce(new Error('radio rejected gps'));
    await act(async () => {
      fireEvent.click(gpsSwitch());
    });
    expect(api.putSensorSetting).toHaveBeenLastCalledWith(client, 'gps', '1');
    expect(gpsSwitch().getAttribute('aria-checked')).toBe('false');
    expect(notify.error.mock.calls[0][0]).toBe('GPS save failed: radio rejected gps');
  });

  it('saves the interval on blur', async () => {
    seedRadio();
    await mountSensors();
    fireEvent.change(intervalInput(), { target: { value: '900' } });
    await act(async () => {
      fireEvent.blur(intervalInput());
    });
    expect(api.putSensorSetting).toHaveBeenCalledWith(client, 'gps_interval', '900');
    expect(notify.success).toHaveBeenCalledWith('GPS interval saved');
    // Write-only: saving it doesn't make it a setting the radio reported.
    expect(screen.getByText('1 setting reported by the radio')).toBeTruthy();
  });

  it('keeps GPS when the radio refuses only the interval (a partial save)', async () => {
    seedRadio({ gpsIntervalSec: 300 });
    await mountSensors();
    await act(async () => {
      fireEvent.click(gpsSwitch());
    });
    api.putSensorSetting.mockRejectedValueOnce(new Error('radio rejected gps_interval'));
    fireEvent.change(intervalInput(), { target: { value: '120' } });
    await act(async () => {
      fireEvent.keyDown(intervalInput(), { key: 'Enter' });
      fireEvent.blur(intervalInput());
    });
    expect(notify.error.mock.calls[0][0]).toBe('GPS interval save failed: radio rejected gps_interval');
    expect(intervalInput().value).toBe('300');
    expect(gpsSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('refuses an out-of-range interval without asking the radio', async () => {
    seedRadio();
    await mountSensors();
    fireEvent.change(intervalInput(), { target: { value: '5' } });
    fireEvent.blur(intervalInput());
    expect(api.putSensorSetting).not.toHaveBeenCalled();
    expect(notify.error.mock.calls[0][0]).toBe('GPS interval save failed: use 60 to 86399 seconds');
    expect(intervalInput().value).toBe('300');
  });

  it('Escape abandons the edit', async () => {
    seedRadio();
    await mountSensors();
    fireEvent.change(intervalInput(), { target: { value: '1200' } });
    fireEvent.keyDown(intervalInput(), { key: 'Escape' });
    fireEvent.blur(intervalInput());
    expect(api.putSensorSetting).not.toHaveBeenCalled();
    expect(intervalInput().value).toBe('300');
  });
});
