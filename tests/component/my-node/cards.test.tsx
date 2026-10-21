import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// My Node's connected cards and the page around them: what each card shows
// from the store and the poll, and where its buttons and links go.

const { api } = vi.hoisted(() => ({
  api: {
    listTelemetry: vi.fn(async () => []),
    readSelfTelemetryLive: vi.fn(() => new Promise(() => {})),
    getDeviceStats: vi.fn(() => new Promise(() => {})),
    getAdvertLink: vi.fn(() => new Promise(() => {})),
    saveSelfTelemetrySnapshot: vi.fn(async () => ({})),
    sendAdvert: vi.fn(async () => {}),
  },
}));
vi.mock('../../../src/renderer/lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../src/renderer/lib/api')>()),
  api,
}));
vi.mock('../../../src/renderer/lib/notify', () => import('../../support/notifyMock'));

import type { StreamState } from '../../../src/renderer/features/my-node/poll';
import { QUICK_ACTIONS_BY_ID } from '../../../src/renderer/features/quick-actions/catalog';
import { ApiError } from '../../../src/renderer/lib/api';
import { useStore } from '../../../src/renderer/lib/store';
import { AdvertCard } from '../../../src/renderer/panels/my-node/cards/AdvertCard';
import { DeviceCard } from '../../../src/renderer/panels/my-node/cards/DeviceCard';
import { LocationCard } from '../../../src/renderer/panels/my-node/cards/LocationCard';
import { RadioCard } from '../../../src/renderer/panels/my-node/cards/RadioCard';
import { TelemetryCard } from '../../../src/renderer/panels/my-node/cards/TelemetryCard';
import { MyNodePage } from '../../../src/renderer/panels/my-node/MyNodePage';
import { NODE_TELEMETRY_KEY } from '../../../src/shared/keys';
import { decodeLpp, hexToBytes } from '../../../src/shared/telemetry/lpp';
import type { SelfLiveReadDto } from '../../../src/shared/telemetry/types';
import { DEFAULT_DEVICE_INFO, type DeviceStats } from '../../../src/shared/types';
import { notify, resetNotifyMock } from '../../support/notifyMock';
import { renderWithClient } from '../../support/renderWithClient';
import { OWN, SELF_HEX, seedRadio, selfRead } from '../my-radio/helpers';

const NOW = new Date(2026, 9, 21, 14, 0, 0).getTime();

function liveRead(hex = SELF_HEX, at = NOW): SelfLiveReadDto {
  const raw = hexToBytes(hex) as Uint8Array;
  return { at, rawHex: hex.replace(/ /g, '').toLowerCase(), readings: decodeLpp(raw).readings };
}

function stream<T>(value: T | null, over: Partial<StreamState<T>> = {}): StreamState<T> {
  return { value, updatedAt: value ? NOW : null, supported: true, failures: 0, warn: false, error: null, ...over };
}

const STATS: DeviceStats = {
  core: { kind: 'core', battMv: 4040, uptimeSecs: 3600, errFlags: 0, queueLen: 0 },
  radio: { kind: 'radio', noiseFloor: -112, lastRssi: -80, lastSnrDb: 9.5, txAirSecs: 12, rxAirSecs: 40 },
  packets: {
    kind: 'packets',
    recv: 120,
    sent: 30,
    nSentFlood: 20,
    nSentDirect: 10,
    nRecvFlood: 100,
    nRecvDirect: 20,
    nRecvErrors: 1,
  },
  at: NOW,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetNotifyMock();
  for (const fn of Object.values(api)) fn.mockClear();
  seedRadio();
  useStore.getState().setActiveKey('tool:node');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Telemetry card', () => {
  it('shows each live reading, with a "was … at" line from the latest snapshot', () => {
    // An earlier snapshot at 3.81 V (01 74 01 7d), 25.0 °C.
    seedRadio({ reads: [selfRead('s1', NOW - 3_600_000, '01 74 01 7D 02 67 00 FA')] });
    renderWithClient(<TelemetryCard stream={stream(liveRead())} connected ownerKey={OWN} />);
    expect(screen.getByText('4.04')).toBeTruthy();
    expect(screen.getByText(/was 3\.81 V at/)).toBeTruthy();
    expect(screen.getByText(/was 25(\.0)? °C at/)).toBeTruthy();
  });

  it('enables Save snapshot only for a fresh read while connected, and toasts the result', async () => {
    const { rerender } = renderWithClient(<TelemetryCard stream={stream(liveRead())} connected ownerKey={OWN} />);
    const save = screen.getByRole('button', { name: 'Save snapshot' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Snapshot saved'));
    expect(api.saveSelfTelemetrySnapshot).toHaveBeenCalledTimes(1);

    rerender(<TelemetryCard stream={stream(liveRead(SELF_HEX, NOW - 21_000))} connected ownerKey={OWN} />);
    expect((screen.getByRole('button', { name: 'Save snapshot' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<TelemetryCard stream={stream(liveRead())} connected={false} ownerKey={OWN} />);
    expect((screen.getByRole('button', { name: 'Save snapshot' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports a failed save', async () => {
    api.saveSelfTelemetrySnapshot.mockRejectedValueOnce(new Error('stale'));
    renderWithClient(<TelemetryCard stream={stream(liveRead())} connected ownerKey={OWN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save snapshot' }));
    await waitFor(() => expect(notify.failure).toHaveBeenCalledWith('Save snapshot', expect.any(Error)));
  });

  it('lists recent snapshots and links to the full history', () => {
    seedRadio({
      reads: [selfRead('s3', NOW - 60_000), selfRead('s2', NOW - 120_000), selfRead('s1', NOW - 180_000)],
    });
    renderWithClient(<TelemetryCard stream={stream(liveRead())} connected ownerKey={OWN} />);
    expect(screen.getAllByText(/^Today \d\d:\d\d · 4\.04 V/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'View all 3' }));
    expect(useStore.getState().ui.activeKey).toBe(NODE_TELEMETRY_KEY);
  });

  it('says when the firmware can’t report its own telemetry', () => {
    renderWithClient(
      <TelemetryCard stream={stream<SelfLiveReadDto>(null, { supported: false })} connected ownerKey={OWN} />,
    );
    expect(screen.getByText("This firmware can't report its own telemetry.")).toBeTruthy();
  });
});

describe('Device card', () => {
  it('calls out a full contact table and links to Contacts', () => {
    useStore.setState({
      deviceInfo: { ...DEFAULT_DEVICE_INFO, maxContacts: 2, maxChannels: 8 },
      contacts: [
        { key: `c:${'01'.repeat(32)}`, publicKeyHex: '01'.repeat(32), name: 'A', kind: 'chat' },
        { key: `c:${'02'.repeat(32)}`, publicKeyHex: '02'.repeat(32), name: 'B', kind: 'chat' },
      ],
    });
    renderWithClient(<DeviceCard />);
    const callout = screen.getByRole('status');
    expect(within(callout).getByText("Contacts full — new adverts won't be added.")).toBeTruthy();
    fireEvent.click(within(callout).getByRole('button', { name: 'Manage' }));
    expect(useStore.getState().ui.activeKey).toBe('tool:contacts');
  });

  it('has no callout with room to spare', () => {
    useStore.setState({ deviceInfo: { ...DEFAULT_DEVICE_INFO, maxContacts: 100 }, contacts: [] });
    renderWithClient(<DeviceCard />);
    expect(screen.queryByText(/Contacts full/)).toBeNull();
  });
});

describe('Radio card', () => {
  it('links to Radio Settings', () => {
    renderWithClient(<RadioCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Radio Settings' }));
    expect(useStore.getState().ui.activeKey).toBe('tool:settings:radio');
  });
});

describe('Location card', () => {
  it('runs the owner card’s GPS and share quick actions from its switches', async () => {
    const gps = vi.spyOn(QUICK_ACTIONS_BY_ID.gps, 'run').mockResolvedValue(undefined);
    const share = vi.spyOn(QUICK_ACTIONS_BY_ID.shareLoc, 'run').mockResolvedValue(undefined);
    renderWithClient(<LocationCard />);
    fireEvent.click(screen.getByRole('switch', { name: 'GPS' }));
    await waitFor(() => expect(gps).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByRole('switch', { name: 'Share in advert' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Share in advert' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  });

  it('disables the switches while disconnected', () => {
    seedRadio({ connected: false });
    renderWithClient(<LocationCard />);
    expect((screen.getByRole('switch', { name: 'GPS' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Advert card', () => {
  it('sends a flood or zero-hop advert and toasts it', async () => {
    renderWithClient(<AdvertCard />);
    fireEvent.click(screen.getByRole('button', { name: 'Flood advert' }));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Self-advert sent'));
    expect(api.sendAdvert).toHaveBeenLastCalledWith(expect.anything(), true);
    fireEvent.click(screen.getByRole('button', { name: 'Zero-hop advert' }));
    await waitFor(() => expect(api.sendAdvert).toHaveBeenLastCalledWith(expect.anything(), false));
  });
});

describe('My node page', () => {
  const page = () => renderWithClient(<MyNodePage onScan={() => {}} onConnect={() => {}} onDisconnect={() => {}} />);

  it('shows Radio stats when the firmware answers', async () => {
    api.readSelfTelemetryLive.mockResolvedValue(liveRead() as never);
    api.getDeviceStats.mockResolvedValue(STATS as never);
    page();
    expect(await screen.findByText('Radio stats')).toBeTruthy();
    for (const title of ['Telemetry', 'Device', 'Radio', 'Location', 'Identity & sharing', 'Advert activity']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('hides Radio stats on firmware without the command', async () => {
    api.readSelfTelemetryLive.mockResolvedValue(liveRead() as never);
    api.getDeviceStats.mockRejectedValue(new ApiError('unsupported', 501, null) as never);
    page();
    await act(async () => {});
    await waitFor(() => expect(api.getDeviceStats).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText('Radio stats')).toBeNull();
    expect(screen.getByText('Telemetry')).toBeTruthy();
  });

  it('disconnected: the connection card first, and scanning goes through the handler', () => {
    seedRadio({ connected: false });
    const onScan = vi.fn();
    renderWithClient(<MyNodePage onScan={onScan} onConnect={() => {}} onDisconnect={() => {}} />);
    expect(screen.getByText('Radio connection')).toBeTruthy();
    expect(screen.queryByText('Telemetry')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan for radios' }));
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});
