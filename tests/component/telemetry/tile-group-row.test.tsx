import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fmtWhen, previousByOffset } from '../../../src/renderer/features/telemetry/format';
import { hasTelemetryIcon } from '../../../src/renderer/features/telemetry/icons';
import { TelemetryGroup } from '../../../src/renderer/features/telemetry/TelemetryGroup';
import { rowValue, TelemetryRow } from '../../../src/renderer/features/telemetry/TelemetryRow';
import { TelemetryTile } from '../../../src/renderer/features/telemetry/TelemetryTile';
import { fmtTime } from '../../../src/renderer/lib/time';
import { describeChannels } from '../../../src/shared/telemetry/describe';
import { decodeLpp, hexToBytes, LPP_TYPES } from '../../../src/shared/telemetry/lpp';
import { previousForRequest } from '../../../src/shared/telemetry/previous';
import type { PreviousReading } from '../../../src/shared/telemetry/types';
import { dto, groups, PLAN_FIXTURE, use24h } from './helpers';

const AT = new Date(2026, 9, 9, 19, 15).getTime();

function prev(hex: string, index = 0): PreviousReading {
  const reading = decodeLpp(hexToBytes(hex) as Uint8Array).readings[index];
  return { reading, requestedAt: AT, requestId: 'p' };
}

const plan = groups(PLAN_FIXTURE);
const self = plan[0];
const battery = self.readings[0];
const gps = self.readings[1];
const env = plan[1];
const temp = env.readings[0];

beforeEach(() => use24h());

describe('TelemetryTile', () => {
  it('shows value, unit, type meta and the battery estimate + bar, with no history line without a previous', () => {
    render(<TelemetryTile reading={battery} />);
    expect(screen.getByText('Battery')).toBeTruthy();
    expect(screen.getByText('4.25')).toBeTruthy();
    expect(screen.getByText('V')).toBeTruthy();
    expect(screen.getByText('voltage · 116')).toBeTruthy();
    expect(screen.getByText(`≈ ${battery.batteryPercent}% est.`)).toBeTruthy();
    expect(screen.getByTestId('battery-bar')).toBeTruthy();
    expect(screen.queryByTestId('tile-delta')).toBeNull();
  });

  it('hides the estimate and bar outside the LiPo range', () => {
    // 12.60 V: a lead-acid/solar repeater, no LiPo curve.
    const [d] = groups('01 74 04 EC')[0].readings;
    expect(d.batteryPercent).toBeNull();
    render(<TelemetryTile reading={d} />);
    expect(screen.getByText('12.60')).toBeTruthy();
    expect(screen.queryByText(/est\./)).toBeNull();
    expect(screen.queryByTestId('battery-bar')).toBeNull();
  });

  it('adds "▲ +0.03 V · was 4.22 V at HH:MM" when a previous exists', () => {
    render(<TelemetryTile reading={battery} previous={prev('01 74 01 A6')} />);
    const line = screen.getByTestId('tile-delta');
    expect(line.textContent).toBe(`▲ up +0.03 V · was 4.22 V at ${fmtWhen(AT, '24h')}`);
  });

  it('dates a previous value from another day, and gives only the time for today', () => {
    // Guest and failed requests in between are skipped, so "previous" can be days back.
    const { unmount } = render(<TelemetryTile reading={battery} previous={prev('01 74 01 A6')} />);
    const old = screen.getByTestId('tile-delta').textContent ?? '';
    expect(old).toContain(new Date(AT).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    unmount();

    const today = Date.now() - 60_000;
    render(<TelemetryTile reading={battery} previous={{ ...prev('01 74 01 A6'), requestedAt: today }} />);
    expect(screen.getByTestId('tile-delta').textContent).toBe(`▲ up +0.03 V · was 4.22 V at ${fmtTime(today, '24h')}`);
  });

  it('shows a fall with the Unicode minus', () => {
    render(<TelemetryTile reading={temp} previous={prev('02 67 01 17')} />);
    const line = screen.getByTestId('tile-delta');
    expect(line.textContent).toContain('▼');
    expect(line.textContent).toContain('−3.3 °C');
    expect(line.textContent).toContain('was 27.9 °C at');
    // The env tile's secondary stays.
    expect(screen.getByText('76.3 °F')).toBeTruthy();
  });

  it('reads "= unchanged since HH:MM" when the value is equal', () => {
    render(<TelemetryTile reading={temp} previous={prev('02 67 00 F6')} />);
    expect(screen.getByTestId('tile-delta').textContent).toBe(`= unchanged since ${fmtWhen(AT, '24h')}`);
  });

  it('keeps the current tile unit for the previous value (mA)', () => {
    const current = plan[2].readings[1]; // 182 mA
    render(<TelemetryTile reading={current} previous={prev('03 75 00 C8')} />);
    expect(screen.getByTestId('tile-delta').textContent).toContain('was 200 mA at');
  });

  it('GPS: unicode-minus coordinates, altitude row, advert gap and actions', () => {
    const onViewOnMap = vi.fn();
    render(
      <TelemetryTile
        reading={gps}
        previous={prev(PLAN_FIXTURE, 1)}
        advertPosition={{ lat: 30.2114, lon: -97.7624 }}
        onViewOnMap={onViewOnMap}
      />,
    );
    expect(screen.getByText('30.2114, −97.7622')).toBeTruthy();
    expect(screen.getByText('Altitude')).toBeTruthy();
    expect(screen.getByText('168.40 m · 552 ft')).toBeTruthy();
    const line = screen.getByTestId('tile-delta').textContent ?? '';
    expect(line).toBe(`= unchanged since ${fmtWhen(AT, '24h')} · 19 m from advertised`);
    fireEvent.click(screen.getByText('View on map'));
    expect(onViewOnMap).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Copy')).toBeTruthy();
  });

  it('GPS without previous or advert has no history line and no map button', () => {
    render(<TelemetryTile reading={gps} />);
    expect(screen.queryByTestId('tile-delta')).toBeNull();
    expect(screen.queryByText('View on map')).toBeNull();
  });

  it('GPS with an advert but no previous shows only the advert gap', () => {
    render(<TelemetryTile reading={gps} advertPosition={{ lat: 30.2114, lon: -97.7622 }} />);
    expect(screen.getByTestId('tile-delta').textContent).toBe('0 m from advertised');
  });
});

describe('TelemetryGroup', () => {
  it('renders the header (Ch N, name, match caption, permission chip) and one tile per reading', () => {
    render(<TelemetryGroup group={env} showPermission />);
    expect(screen.getByText('Ch 2')).toBeTruthy();
    // The group name and the permission chip.
    expect(screen.getAllByText('Environment')).toHaveLength(2);
    expect(screen.getByText('field set matches BME280')).toBeTruthy();
    expect(screen.getAllByTestId('telemetry-tile')).toHaveLength(4);
  });

  it('labels ch 1 Base · Location when it carries GPS, and hides the chip unless asked', () => {
    const { rerender } = render(<TelemetryGroup group={self} showPermission />);
    expect(screen.getByText('Base · Location')).toBeTruthy();
    expect(screen.getByText('Self')).toBeTruthy();
    rerender(<TelemetryGroup group={self} />);
    expect(screen.queryByText('Base · Location')).toBeNull();
  });

  it('hands each tile its previous by reading offset; a new sensor gets none', () => {
    const older = dto('old', AT, '01 74 01 A6 02 67 01 17');
    const current = dto('new', AT + 3_600_000, PLAN_FIXTURE);
    const previous = previousByOffset(current.readings, previousForRequest([current, older], current));
    const [g1, g2, g3] = describeChannels(current.readings);
    render(
      <>
        <TelemetryGroup group={g1} previous={previous} />
        <TelemetryGroup group={g2} previous={previous} />
        <TelemetryGroup group={g3} previous={previous} />
      </>,
    );
    // Battery and temperature had earlier values; nothing else did.
    expect(screen.getAllByTestId('tile-delta')).toHaveLength(2);
  });
});

describe('TelemetryRow', () => {
  it('shows icon label and value; battery and temperature carry their short secondary', () => {
    expect(rowValue(battery)).toBe(`4.25 V · ≈ ${battery.batteryPercent}% est.`);
    expect(rowValue(temp)).toBe('24.6 °C · 76.3 °F');
    expect(rowValue(env.readings[1])).toBe('58.5%'); // dew point stays on the tile
    expect(rowValue(battery, true)).toBe('4.25 V');
  });

  it('renders a label override and the value', () => {
    render(<TelemetryRow reading={plan[2].readings[0]} label="Ch 3 voltage" compact />);
    expect(screen.getByText('Ch 3 voltage')).toBeTruthy();
    expect(screen.getByText('5.12 V')).toBeTruthy();
  });

  it('GPS row uses the Unicode minus', () => {
    render(<TelemetryRow reading={gps} />);
    expect(screen.getByText('30.2114, −97.7622')).toBeTruthy();
  });
});

describe('telemetry icons', () => {
  it('maps every registry icon and the describe overrides', () => {
    for (const t of Object.values(LPP_TYPES)) expect(hasTelemetryIcon(t.icon), t.icon).toBe(true);
    for (const name of ['Battery', 'Cpu', 'Target', 'CircleHelp']) expect(hasTelemetryIcon(name)).toBe(true);
  });
});
