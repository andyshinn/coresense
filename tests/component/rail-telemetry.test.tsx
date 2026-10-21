import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Right rail › Telemetry (DECISIONS B13): visibility, pinned rows, the header
// stamp, request gating and the link into the Telemetry tab.

const { api, notify } = vi.hoisted(() => ({
  api: {
    listTelemetry: vi.fn(async (): Promise<unknown[]> => []),
    requestTelemetry: vi.fn(),
    repeaterSession: vi.fn(async (): Promise<{ session: unknown }> => ({ session: null })),
    getAdvertPath: vi.fn(async () => ({ cached: false, reason: 'not_cached' })),
    addToRadio: vi.fn(),
    setFavourite: vi.fn(),
    removeFromRadio: vi.fn(),
  },
  notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/notify', () => ({ notify }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});

import { useStore } from '@/lib/store';
import { LOGIN_HINT, RADIO_BUSY_HINT } from '@/lib/telemetry';
import { ContactDetail } from '@/shell/rightrail/sections/ContactDetail';
import { pinnedTelemetryRows, TelemetryRailSection, TelemetryRailStamp } from '@/shell/rightrail/sections/TelemetryRail';
import { type RailData, sectionsFor } from '@/shell/rightrail/sectionsFor';
import type { SavedRequestDto, TelemetryInFlight } from '../../src/shared/telemetry/types';
import type { Contact } from '../../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../../src/shared/types';
import { TEST_CLIENT } from '../support/apiClient';
import { renderWithClient } from '../support/renderWithClient';
import { dto, groups, INA3221_FIXTURE, PLAN_FIXTURE, T1000E_REMOTE } from './telemetry/helpers';

const PK = 'aa'.repeat(32);
const client = TEST_CLIENT;
const repeater: Contact = { key: `c:${PK}`, publicKeyHex: PK, name: 'Repeater A', kind: 'repeater' };
const sensor: Contact = { ...repeater, name: 'Sensor S', kind: 'sensor' };
const chat: Contact = { key: `c:${'cc'.repeat(32)}`, publicKeyHex: 'cc'.repeat(32), name: 'Erin', kind: 'chat' };

const data = (over: Partial<RailData> = {}): RailData => ({
  channel: null,
  contact: repeater,
  selectedMessage: null,
  mentionedContact: null,
  repeaters: [],
  repeaterAdminActiveTab: null,
  cardPublicKeyHex: PK,
  ...over,
});
const actions = { clearMentionedContact: () => {} };

/** Seed a loaded list (newest first) so the section doesn't fetch. */
function seed(list: SavedRequestDto[], over: Record<string, unknown> = {}): void {
  useStore.setState({
    telemetryByNode: { [PK]: list },
    telemetryLoaded: { [PK]: true },
    ...over,
  });
}

const flight = (nodeKey: string, over: Partial<TelemetryInFlight> = {}): TelemetryInFlight => ({
  nodeKey,
  source: 'repeater',
  startedAt: Date.now() - 4000,
  deadlineAt: null,
  ...over,
});

const button = () => screen.getByText(/^(Request telemetry|Requesting…)$/).closest('button') as HTMLButtonElement;

beforeEach(() => {
  useStore.setState({
    appSettings: { ...DEFAULT_APP_SETTINGS, timeFormat: '24h' },
    telemetryByNode: {},
    telemetryLoaded: {},
    telemetryInFlight: [],
    telemetrySelectedId: {},
    telemetryCompare: {},
    telemetryFetchLedger: {},
    repeaterAdminTab: null,
    repeaterAdminActiveTab: null,
  });
  for (const fn of Object.values(api)) fn.mockClear();
  for (const fn of Object.values(notify)) fn.mockClear();
  api.repeaterSession.mockImplementation(async () => ({ session: null }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sectionsFor — telemetry section', () => {
  const ids = (d: RailData) => sectionsFor(`c:${PK}`, d, actions).map((s) => s.id);

  it('follows the contact card for a repeater and a sensor', () => {
    expect(ids(data())).toEqual(['rail.contact.card', 'rail.contact.telemetry', 'rail.contact.path']);
    expect(ids(data({ contact: sensor }))).toContain('rail.contact.telemetry');
  });

  it('is absent for chat contacts and for a contact not on the radio', () => {
    expect(ids(data({ contact: chat, cardPublicKeyHex: chat.publicKeyHex }))).not.toContain('rail.contact.telemetry');
    expect(ids(data({ contact: { ...repeater, kind: 'room' } }))).not.toContain('rail.contact.telemetry');
    // data.contact comes from the radio's contact list; a discovered-only node has none.
    expect(ids(data({ contact: null }))).not.toContain('rail.contact.telemetry');
  });

  it('targets the focal repeater, not the selected neighbour on the Neighbours tab', () => {
    const sections = sectionsFor(
      `c:${PK}`,
      data({ repeaterAdminActiveTab: 'neighbours', cardPublicKeyHex: 'bb'.repeat(32) }),
      actions,
    );
    expect(sections.map((s) => s.id)).toEqual([
      'rail.repeater.neighbours',
      'rail.contact.card',
      'rail.contact.telemetry',
      'rail.contact.path',
    ]);
    const telemetry = sections.find((s) => s.id === 'rail.contact.telemetry');
    if (!telemetry?.trailing) throw new Error('telemetry section missing');
    expect((telemetry.body() as ReactElement<{ contact: Contact }>).props.contact).toBe(repeater);
    expect((telemetry.trailing() as ReactElement<{ contact: Contact }>).props.contact).toBe(repeater);
  });
});

describe('pinnedTelemetryRows', () => {
  const labels = (hex: string) => pinnedTelemetryRows(groups(hex)).map((r) => r.label ?? r.reading.label);

  it('puts battery first, one row per channel, then the position', () => {
    expect(labels(PLAN_FIXTURE)).toEqual(['Battery', 'Temperature', 'Ch 3 bus voltage', 'GPS']);
  });

  it('prefixes every power channel and leaves the MCU temperature out', () => {
    expect(labels(INA3221_FIXTURE)).toEqual(['Battery', 'Ch 2 bus voltage', 'Ch 3 bus voltage', 'Ch 4 bus voltage']);
  });

  it('keeps a ch 1 sensor (T1000-E) alongside the battery and GPS', () => {
    const rows = labels(T1000E_REMOTE);
    expect(rows[0]).toBe('Battery');
    expect(rows).toHaveLength(3);
    expect(rows).not.toContain('MCU temp');
    expect(rows.at(-1)).toBe('GPS');
  });
});

describe('TelemetryRailSection', () => {
  it('loads the saved requests lazily on mount', async () => {
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(screen.getByText('Loading saved requests')).toBeTruthy();
    await waitFor(() => expect(api.listTelemetry).toHaveBeenCalledWith(client, PK));
    await screen.findByText('No telemetry yet.');
  });

  it("shows the newest request's pinned rows and the saved-request count", () => {
    seed([dto('r2', Date.now() - 12_000, PLAN_FIXTURE), dto('r1', Date.now() - 60_000, PLAN_FIXTURE)]);
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(screen.getByText('4.25 V · ≈ 100% est.')).toBeTruthy();
    expect(screen.getByText('Ch 3 bus voltage')).toBeTruthy();
    expect(screen.getByText('2 saved requests')).toBeTruthy();
    expect(screen.queryByText(/Older request/)).toBeNull();
    expect(api.listTelemetry).not.toHaveBeenCalled();
  });

  it('flags a selected request that is not the newest, and one over an hour old', () => {
    seed([dto('r2', Date.now() - 12_000, PLAN_FIXTURE), dto('r1', Date.now() - 60_000, PLAN_FIXTURE)], {
      telemetrySelectedId: { [PK]: 'r1' },
    });
    const { unmount } = renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(screen.getByText(/Older request/)).toBeTruthy();
    unmount();

    seed([dto('r1', Date.now() - 2 * 3_600_000, PLAN_FIXTURE)], { telemetrySelectedId: {} });
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(screen.getByText(/Older request/)).toBeTruthy();
  });

  it('reports a failed newest request and falls back to the previous reply', () => {
    seed([
      dto('r2', Date.now() - 5_000, null, { outcome: 'timeout', roundTripMs: 15_000, route: 'flood', hops: null }),
      dto('r1', Date.now() - 60_000, PLAN_FIXTURE),
    ]);
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(screen.getByText('Telemetry request failed: no reply in 15 s · flood')).toBeTruthy();
    expect(screen.getByText('Battery')).toBeTruthy();
    expect(screen.getByText(/Older request/)).toBeTruthy();
  });

  it('requests telemetry for the focal node and toasts the outcome', async () => {
    seed([]);
    api.requestTelemetry.mockResolvedValueOnce(dto('r1', Date.now(), PLAN_FIXTURE));
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    fireEvent.click(button());
    await waitFor(() => expect(api.requestTelemetry).toHaveBeenCalledWith(client, repeater.key));
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Telemetry saved'));
  });

  it('words a 409 the way the tab does', async () => {
    seed([]);
    api.requestTelemetry.mockRejectedValueOnce(
      Object.assign(new Error('Waiting for another mesh request'), { code: 'radio_busy' }),
    );
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    fireEvent.click(button());
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Telemetry request failed: radio busy', expect.any(Error)),
    );
  });

  it('disables the button and shows the wait while this node is in flight', () => {
    seed([], { telemetryInFlight: [flight(PK)] });
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(button().disabled).toBe(true);
    // The tab's label: the same control.
    expect(button().textContent).toBe('Requesting…');
    // The ticking counter is hidden from screen readers; a static status says it once.
    const counter = screen.getByText(/^waiting for reply · 4 s/);
    expect(counter.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Requesting telemetry');
  });

  it('disables the button with the busy hint while another node holds the radio', () => {
    seed([], { telemetryInFlight: [flight('bb'.repeat(32))] });
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe(RADIO_BUSY_HINT);
    expect(screen.getByText(RADIO_BUSY_HINT)).toBeTruthy();
  });

  it('keeps the button enabled with the login hint for a repeater with no session', async () => {
    seed([]);
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    await screen.findByText(LOGIN_HINT);
    expect(button().disabled).toBe(false);
  });

  it('shows no login hint once logged in, for a repeater or a sensor', async () => {
    seed([]);
    api.repeaterSession.mockImplementation(async () => ({ session: { role: 'admin' } }));
    const { unmount } = renderWithClient(<TelemetryRailSection contact={repeater} />);
    await waitFor(() => expect(api.repeaterSession).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(LOGIN_HINT)).toBeNull();
    unmount();

    api.repeaterSession.mockClear();
    renderWithClient(<TelemetryRailSection contact={sensor} />);
    await waitFor(() => expect(api.repeaterSession).toHaveBeenCalledWith(client, sensor.key));
    await act(async () => {});
    expect(screen.queryByText(LOGIN_HINT)).toBeNull();
  });

  it('gives a sensor with no session the login hint (sensors drop non-ACL clients too)', async () => {
    seed([]);
    renderWithClient(<TelemetryRailSection contact={sensor} />);
    await screen.findByText(LOGIN_HINT);
    expect(button().disabled).toBe(false);
  });

  it('re-reads the session on a login or logout in RepeaterAdmin, with no tab switch', async () => {
    seed([]);
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    await screen.findByText(LOGIN_HINT);

    api.repeaterSession.mockImplementation(async () => ({ session: { role: 'admin' } }));
    act(() => useStore.getState().bumpRepeaterAdminSessionRev());
    await waitFor(() => expect(screen.queryByText(LOGIN_HINT)).toBeNull());

    api.repeaterSession.mockImplementation(async () => ({ session: null }));
    act(() => useStore.getState().bumpRepeaterAdminSessionRev());
    await screen.findByText(LOGIN_HINT);
  });

  it('says "Base only" for a guest repeater reply, not for a guest-role sensor reply (granted everything)', () => {
    seed([dto('g', Date.now() - 5_000, '01 74 01 A9 01 67 01 36', { aclRole: 'guest', permsGranted: 1 })]);
    const { unmount } = renderWithClient(<TelemetryRailSection contact={repeater} />);
    expect(screen.getByText('Base only · guest login')).toBeTruthy();
    unmount();

    seed([dto('s', Date.now() - 5_000, PLAN_FIXTURE, { aclRole: 'guest', permsGranted: 7 })]);
    renderWithClient(<TelemetryRailSection contact={sensor} />);
    expect(screen.queryByText('Base only · guest login')).toBeNull();
  });

  it('opens the Telemetry tab from the saved-requests link', () => {
    seed([dto('r1', Date.now() - 12_000, PLAN_FIXTURE)]);
    renderWithClient(<TelemetryRailSection contact={repeater} />);
    fireEvent.click(screen.getByText('1 saved request'));
    expect(useStore.getState().repeaterAdminTab).toBe('telemetry');
    expect(useStore.getState().ui.activeKey).toBe(repeater.key);
  });
});

describe('TelemetryRailStamp', () => {
  it('reads "from HH:MM · age" for the shown request', () => {
    const at = new Date(2026, 9, 9, 21, 29, 0).getTime();
    vi.useFakeTimers({ now: at + 12_000, toFake: ['Date'] });
    seed([dto('r1', at, PLAN_FIXTURE)]);
    render(<TelemetryRailStamp contact={repeater} />);
    expect(screen.getByText('from 21:29 · 12 s ago')).toBeTruthy();
  });

  it('renders nothing with no saved request', () => {
    seed([]);
    const { container } = render(<TelemetryRailStamp contact={repeater} />);
    expect(container.textContent).toBe('');
  });
});

describe('ContactDetail — Telemetry button', () => {
  it('opens the repeater Telemetry tab', () => {
    useStore.setState({
      contacts: [repeater],
      discovered: [
        {
          key: repeater.key,
          publicKeyHex: PK,
          name: repeater.name,
          kind: 'repeater',
          firstHeardMs: 1_750_000_000_000,
          onRadio: true,
          favourite: false,
          blocked: false,
        },
      ],
    });
    renderWithClient(<ContactDetail publicKeyHex={PK} showPath={false} />);
    fireEvent.click(screen.getByText('Telemetry'));
    expect(useStore.getState().repeaterAdminTab).toBe('telemetry');
    expect(useStore.getState().ui.activeKey).toBe(repeater.key);
  });
});
