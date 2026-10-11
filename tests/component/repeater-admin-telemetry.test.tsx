import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NeighboursTab (imported by the RepeaterAdmin index) pulls in maplibre, which
// can't boot in jsdom; this file never opens that tab.
vi.mock('../../src/renderer/components/map/MapCanvas', () => ({ MapCanvas: () => null }));
vi.mock('../../src/renderer/components/map/NeighbourMapLayer', () => ({ NeighbourMapLayer: () => null }));
vi.mock('../../src/renderer/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const listTelemetry = vi.fn(async (): Promise<SavedRequestDto[]> => []);
const requestTelemetry = vi.fn();
const repeaterOwner = vi.fn(async () => ({ ok: true, info: { firmwareVersion: 'FW', nodeName: 'n', ownerInfo: 'o' } }));
vi.mock('../../src/renderer/lib/api', () => ({
  api: {
    repeaterSession: vi.fn(async () => ({ session: null })),
    listTelemetry: (...a: unknown[]) => listTelemetry(...(a as [])),
    requestTelemetry: (...a: unknown[]) => requestTelemetry(...a),
    repeaterOwner: () => repeaterOwner(),
    repeaterLogin: vi.fn(async () => ({
      session: {
        contactKey: `c:${'aa'.repeat(32)}`,
        publicKeyHex: 'aa'.repeat(32),
        role: 'guest',
        mode: 'flood',
        permissionsBits: 0,
        aclPermissionsBits: null,
        aclRole: null,
        firmwareVerLevel: null,
        loggedInAt: 1,
      },
      login: { effective: 'flood' },
    })),
  },
}));

import { useStore } from '../../src/renderer/lib/store';
import { RADIO_BUSY_HINT } from '../../src/renderer/lib/telemetry';
import { RepeaterAdmin } from '../../src/renderer/panels/repeater-admin';
import { OwnerTab } from '../../src/renderer/panels/repeater-admin/OwnerTab';
import type { SavedRequestDto, TelemetryInFlight } from '../../src/shared/telemetry/types';
import type { Contact } from '../../src/shared/types';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const PK = 'aa'.repeat(32);
const repeater: Contact = { key: `c:${PK}`, publicKeyHex: PK, name: 'Repeater A', kind: 'repeater' };
const room: Contact = { key: `c:${'cc'.repeat(32)}`, publicKeyHex: 'cc'.repeat(32), name: 'Room', kind: 'room' };

const flight = (source: TelemetryInFlight['source']): TelemetryInFlight => ({
  nodeKey: 'bb'.repeat(32),
  source,
  startedAt: 1,
  deadlineAt: null,
});

beforeEach(() => {
  useStore.setState({
    telemetryByNode: {},
    telemetryLoaded: {},
    telemetryInFlight: [],
    telemetrySelectedId: {},
    telemetryCompare: {},
    telemetryFetchLedger: {},
  });
  listTelemetry.mockClear();
  repeaterOwner.mockClear();
});

afterEach(() => {
  useStore.getState().setRepeaterAdminTab(null);
  useStore.getState().setRepeaterAdminActiveTab(null);
});

describe('RepeaterAdmin — Telemetry tab', () => {
  it('opens from the deep link (contact detail button / palette action) and shows the newest request', async () => {
    listTelemetry.mockResolvedValueOnce([
      {
        id: 'r1',
        nodeKey: PK,
        source: 'repeater',
        requestedAt: Date.now() - 5000,
        repliedAt: Date.now() - 4000,
        outcome: 'ok',
        roundTripMs: 1000,
        hops: 1,
        route: 'direct',
        aclRole: 'admin',
        permsGranted: 7,
        rawHex: '017401a9',
        readings: [{ ch: 1, typeId: 116, offset: 0, len: 4, value: 4.25 }],
        restHex: '',
      },
    ]);
    act(() => useStore.getState().setRepeaterAdminTab('telemetry'));
    render(<RepeaterAdmin contact={repeater} client={client} />);

    expect(screen.getByText('Request telemetry')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('telemetry-tile')).toHaveLength(1));
    expect(screen.getByText('4.25')).toBeTruthy();
    expect(listTelemetry).toHaveBeenCalledWith(client, PK);
  });

  it('hints at the login a repeater needs, and "Log in" switches to the Login tab', async () => {
    act(() => useStore.getState().setRepeaterAdminTab('telemetry'));
    render(<RepeaterAdmin contact={repeater} client={client} />);
    await waitFor(() => expect(screen.getByText(/^No telemetry yet/)).toBeTruthy());
    expect(screen.getByTestId('telemetry-request-hint').textContent).toBe(
      'Repeaters and sensors reply only to logged-in clients',
    );
    fireEvent.click(screen.getByText('Log in'));
    await waitFor(() => expect(screen.getByText(/Log In as Guest/)).toBeTruthy());
  });

  it('hints at the login a sensor needs too (it drops non-ACL clients), and "Log in" goes to its Login tab', async () => {
    const sensor: Contact = { ...repeater, name: 'Sensor', kind: 'sensor' };
    act(() => useStore.getState().setRepeaterAdminTab('telemetry'));
    render(<RepeaterAdmin contact={sensor} client={client} />);
    await waitFor(() =>
      expect(screen.getByText('No telemetry yet. Click Request telemetry to ask this sensor.')).toBeTruthy(),
    );
    expect(screen.getByTestId('telemetry-request-hint').textContent).toBe(
      'Repeaters and sensors reply only to logged-in clients',
    );
    fireEvent.click(screen.getByText('Log in'));
    await waitFor(() => expect(screen.getByText(/Log In as Guest/)).toBeTruthy());
  });

  it('bumps the session revision on a login, so the rail re-reads its login hint', async () => {
    render(<RepeaterAdmin contact={repeater} client={client} />);
    const button = await screen.findByText(/Log In as Guest/);
    const before = useStore.getState().repeaterAdminSessionRev;
    fireEvent.click(button.closest('button') as HTMLButtonElement);
    await waitFor(() => expect(useStore.getState().repeaterAdminSessionRev).toBeGreaterThan(before));
  });

  it('sits between Status and ACL, and only for repeaters and sensors', () => {
    const { unmount } = render(<RepeaterAdmin contact={repeater} client={client} />);
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('title'));
    const at = labels.indexOf('Telemetry');
    expect(labels[at - 1]).toBe('Status');
    expect(labels[at + 1]).toMatch(/^ACL/);
    unmount();

    render(<RepeaterAdmin contact={room} client={client} />);
    expect(screen.queryByTitle('Telemetry')).toBeNull();
  });
});

describe('admin requests while a mesh telemetry request holds the radio', () => {
  it('disables Fetch with the hint, and re-enables it when the request finishes', () => {
    act(() => useStore.getState().applyTelemetryInFlight([flight('repeater')]));
    render(<OwnerTab contact={repeater} client={client} />);
    const fetch = screen.getByText('Fetch').closest('button') as HTMLButtonElement;
    expect(fetch.disabled).toBe(true);
    expect(fetch.title).toBe(RADIO_BUSY_HINT);
    fireEvent.click(fetch);
    expect(repeaterOwner).not.toHaveBeenCalled();

    act(() => useStore.getState().applyTelemetryInFlight([]));
    expect(fetch.disabled).toBe(false);
  });

  it('ignores a companion self read, which takes no lock', () => {
    act(() => useStore.getState().applyTelemetryInFlight([flight('companion')]));
    render(<OwnerTab contact={repeater} client={client} />);
    expect((screen.getByText('Fetch').closest('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the Login button too', () => {
    act(() => useStore.getState().applyTelemetryInFlight([flight('repeater')]));
    render(<RepeaterAdmin contact={repeater} client={client} />);
    const login = screen.getByText(/Log In as Guest/).closest('button') as HTMLButtonElement;
    expect(login.disabled).toBe(true);
    expect(login.title).toBe(RADIO_BUSY_HINT);
  });
});
