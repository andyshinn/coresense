import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedRequestDto } from '../../../src/shared/telemetry/types';

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

import { compareCsvFilename, compareWhen } from '../../../src/renderer/features/telemetry/TelemetryCompare';
import { TelemetryPanel } from '../../../src/renderer/features/telemetry/TelemetryPanel';
import { useStore } from '../../../src/renderer/lib/store';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';
import { dto, PLAN_FIXTURE, use24h } from './helpers';

const PK = 'aa'.repeat(32);
const KEY = `c:${PK}`;
const client = { baseUrl: 'http://x', apiKey: 'k' };
const H = 3_600_000;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOW = Date.now();

// Same position throughout; battery and ch 2 move; ch 3 only in the newest.
const ENV_OLD = '01 74 01 A6 01 88 04 9C 22 F1 15 2A 00 41 C8 02 67 01 17 02 68 62 02 73 27 9D 02 79 00 9C';
const R1 = dto('r1', NOW - 12_000, PLAN_FIXTURE);
const R2 = dto('r2', NOW - 2 * H - 14 * 60_000, ENV_OLD);
const FAILED = dto('r3', NOW - 3 * H, null, { outcome: 'timeout', roundTripMs: 15_000 });
// Ch 2 is a lone temp+humidity sensor here: the field set drifts against BME280.
const DRIFT = dto('r4', NOW - 30 * H, '01 74 01 A6 02 67 00 DC 02 68 70');
const MORE = [5, 6, 7, 8].map((n) => dto(`r${n}`, NOW - (30 + n) * H, ENV_OLD));

function seed(list: SavedRequestDto[], compare: string[] | null) {
  useStore.setState({
    appSettings: { ...DEFAULT_APP_SETTINGS, timeFormat: '24h' },
    telemetryByNode: { [PK]: list },
    telemetryLoaded: { [PK]: true },
    telemetryInFlight: [],
    telemetrySelectedId: {},
    telemetryCompare: compare ? { [PK]: compare } : {},
    telemetryFetchLedger: {},
  });
}

const option = (id: string) => document.querySelector(`[data-request-id="${id}"]`) as HTMLElement;
const rowText = () =>
  Array.from(document.querySelectorAll('[data-testid="compare-row"]')).map((r) => r.textContent?.replace(/\s+/g, ' '));

beforeEach(() => {
  use24h();
  for (const fn of [...Object.values(api), ...Object.values(notify)]) fn.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('TelemetryCompare — the list in compare mode', () => {
  it('switches rows to checkboxes, disables failures and toggles the rest', () => {
    seed([R1, R2, FAILED, DRIFT], ['r1', 'r2']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('failed requests can’t be compared')).toBeTruthy();
    expect(option('r1').getAttribute('aria-selected')).toBe('true');
    expect(option('r3').getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(option('r3'));
    expect(useStore.getState().telemetryCompare[PK]).toEqual(['r1', 'r2']);
    fireEvent.click(option('r4'));
    expect(useStore.getState().telemetryCompare[PK]).toEqual(['r1', 'r2', 'r4']);
    expect(screen.getByText('Compare 3 requests')).toBeTruthy();
    fireEvent.click(option('r2'));
    expect(screen.getByText('Compare 2 requests')).toBeTruthy();
  });

  it('caps the selection at six', () => {
    seed([R1, R2, DRIFT, ...MORE], ['r1', 'r2', 'r4', 'r5', 'r6', 'r7']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('6 selected')).toBeTruthy();
    expect(screen.getByText('max 6')).toBeTruthy();
    fireEvent.click(option('r8'));
    expect(useStore.getState().telemetryCompare[PK]).toHaveLength(6);
  });

  it('asks for a selection when nothing is ticked', () => {
    seed([R1, R2], []);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('Tick saved requests in the list to compare them.')).toBeTruthy();
    expect(screen.getByText('Export CSV').closest('button')?.disabled).toBe(true);
  });
});

describe('TelemetryCompare — the table', () => {
  it('gives each channel its own <tbody>, so its rowgroup header covers only its rows', () => {
    seed([R1, R2], ['r2', 'r1']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const bodies = Array.from(document.querySelectorAll('table tbody'));
    expect(bodies.map((b) => b.querySelector('th[scope="rowgroup"]')?.textContent?.slice(0, 4))).toEqual([
      'Ch 1',
      'Ch 2',
      'Ch 3',
    ]);
  });

  it('puts the newest column left, with its age, and the gap from the newer column on the others', () => {
    seed([R1, R2], ['r2', 'r1']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const heads = Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(heads).toEqual([
      'Reading',
      // The age reads the real clock: allow for a slow run before this render.
      expect.stringMatching(new RegExp(`^${escapeRe(compareWhen(R1.requestedAt, '24h'))}1\\d s ago$`)),
      `${compareWhen(R2.requestedAt, '24h')}2 h 13 m earlier`,
    ]);
    expect(screen.getByText(/^newest on the left · Δ is against the column to its right · spans 2 h 13 m$/)).toBeTruthy();
  });

  it('shows value and change per cell, "—" for a missing reading and "new" for a first appearance', () => {
    seed([R1, R2], ['r1', 'r2']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const rows = rowText();
    expect(rows).toContain('Battery4.25 V▲ up 0.034.22 V');
    expect(rows).toContain('Temperature24.6 °C▼ down 3.327.9 °C');
    expect(rows.find((r) => r?.startsWith('GPS'))).toMatch(/=unchanged/);
    expect(rows.find((r) => r?.startsWith('Bus voltage'))).toBe('Bus voltage5.12 Vnew—');
    expect(screen.getByText(/Ch 3 first appears at/)).toBeTruthy();
    // Group headers per channel.
    expect(screen.getAllByText(/^Ch [123]$/).length).toBeGreaterThanOrEqual(3);
  });

  it('"Show changes only" hides rows whose values never change', () => {
    seed([R1, R2], ['r1', 'r2']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(rowText().some((r) => r?.startsWith('GPS'))).toBe(true);
    const toggle = screen.getByText('Show changes only').closest('button') as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(rowText().some((r) => r?.startsWith('GPS'))).toBe(false);
    expect(rowText().some((r) => r?.startsWith('Battery'))).toBe(true);
  });

  it('stops filtering (and reads unpressed) when the selection drops below two, resuming at two again', () => {
    seed([R1, R2], ['r1', 'r2']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const toggle = () => screen.getByText('Show changes only').closest('button') as HTMLButtonElement;
    fireEvent.click(toggle());
    expect(rowText().some((r) => r?.startsWith('GPS'))).toBe(false);

    fireEvent.click(option('r2'));
    expect(useStore.getState().telemetryCompare[PK]).toEqual(['r1']);
    // One column: every row would read unchanged. Show them all, not "No reading changed".
    expect(toggle().disabled).toBe(true);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(rowText().length).toBeGreaterThan(0);
    expect(rowText().some((r) => r?.startsWith('GPS'))).toBe(true);
    expect(screen.queryByText('No reading changed between these requests.')).toBeNull();

    fireEvent.click(option('r2'));
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(rowText().some((r) => r?.startsWith('GPS'))).toBe(false);
  });

  it('warns when a channel’s field set drifts between columns', () => {
    seed([R2, DRIFT], ['r2', 'r4']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByTestId('compare-drift').textContent).toMatch(/^The field set on ch 2 changes between these requests/);
    expect(screen.getByText('field set changes')).toBeTruthy();
  });

  it('has no drift warning when the field sets agree', () => {
    seed([R1, R2], ['r1', 'r2']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.queryByTestId('compare-drift')).toBeNull();
  });
});

describe('TelemetryCompare — Export CSV', () => {
  it('downloads the shown table as telemetry-<node>-<date>.csv', async () => {
    seed([R1, R2], ['r1', 'r2']);
    let blob: Blob | null = null;
    const create = vi.fn((b: Blob) => {
      blob = b;
      return 'blob:telemetry';
    });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    let anchor: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchor = this;
    });

    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} nodeName="Hilltop RAK" />);
    fireEvent.click(screen.getByText('Export CSV'));

    expect(anchor).not.toBeNull();
    const a = anchor as unknown as HTMLAnchorElement;
    expect(a.download).toBe(compareCsvFilename(KEY, 'Hilltop RAK'));
    expect(a.download).toMatch(/^telemetry-hilltop-rak-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(a.getAttribute('href')).toBe('blob:telemetry');
    expect(document.body.contains(a)).toBe(false);
    expect(notify.success).toHaveBeenCalledWith('CSV exported');

    const text = await (blob as unknown as Blob).text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe(
      `reading,ch,type,${new Date(R1.requestedAt).toISOString()},${new Date(R2.requestedAt).toISOString()}`,
    );
    expect(lines).toContain('Battery (V),1,116,4.25,4.22');
    expect(lines).toContain('Bus voltage (V),3,116,5.12,');
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:telemetry'));
  });

  it('exports only the changed rows while "Show changes only" is on', async () => {
    seed([R1, R2], ['r1', 'r2']);
    let blob: Blob | null = null;
    Object.assign(URL, {
      createObjectURL: (b: Blob) => {
        blob = b;
        return 'blob:x';
      },
      revokeObjectURL: () => {},
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    fireEvent.click(screen.getByText('Show changes only'));
    fireEvent.click(screen.getByText('Export CSV'));
    const text = await (blob as unknown as Blob).text();
    expect(text).not.toMatch(/^GPS/m);
    expect(text).toMatch(/^Battery \(V\)/m);
  });

  it('names the file after the key when the node has no name', () => {
    expect(compareCsvFilename(KEY, undefined, new Date(2026, 9, 10).getTime())).toBe('telemetry-aaaaaaaa-2026-10-10.csv');
    expect(compareCsvFilename(KEY, ' ★ ', new Date(2026, 0, 2).getTime())).toBe('telemetry-aaaaaaaa-2026-01-02.csv');
  });
});

describe('TelemetryCompare — saved-request stats and retention', () => {
  it('shows saved/failed counts, the oldest request and the median round trip', () => {
    seed([R1, FAILED, { ...R2, roundTripMs: 2_200 }], ['r1']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    expect(screen.getByText('3 · 1 failed')).toBeTruthy();
    expect(screen.getByText(compareWhen(R2.requestedAt, '24h'))).toBeTruthy();
    expect(screen.getByText('2.0 s')).toBeTruthy();
    expect(screen.getByText('app-side')).toBeTruthy();
  });

  it('saves the retention on blur, clamped to 1–500', async () => {
    seed([R1, R2], ['r1']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const input = screen.getByLabelText(/Keep per node/) as HTMLInputElement;
    expect(input.value).toBe('50');
    fireEvent.change(input, { target: { value: '9000' } });
    // Not per keystroke: main prunes on a shrink.
    expect(api.putTelemetryRetention).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(notify.success).toHaveBeenCalledWith('Retention saved'));
    expect(api.putTelemetryRetention).toHaveBeenCalledWith(client, expect.objectContaining({ timeFormat: '24h' }), 500);
    expect(input.value).toBe('500');
  });

  it('restores the current value for an empty or unchanged entry, without saving', () => {
    seed([R1], ['r1']);
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const input = screen.getByLabelText(/Keep per node/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.value).toBe('50');
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.blur(input);
    expect(api.putTelemetryRetention).not.toHaveBeenCalled();
  });

  it('reports a failed save and puts the value back', async () => {
    seed([R1], ['r1']);
    api.putTelemetryRetention.mockRejectedValueOnce(new Error('offline'));
    render(<TelemetryPanel source="repeater" nodeKey={KEY} client={client} />);
    const input = screen.getByLabelText(/Keep per node/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Saving retention failed: offline', expect.any(Error)));
    expect(api.putTelemetryRetention).toHaveBeenCalledWith(client, expect.anything(), 1);
    expect(input.value).toBe('50');
  });
});
