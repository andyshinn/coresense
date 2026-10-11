import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { explainReading, LppInspector } from '../../../src/renderer/features/telemetry/LppInspector';
import { hexToBytes } from '../../../src/shared/telemetry/lpp';
import { dto, groups, INA3221_FIXTURE, PLAN_FIXTURE } from './helpers';

const flat = (hex: string) => groups(hex).flatMap((g) => g.readings);

function renderInspector(hex: string, defaultOpen = false) {
  const req = dto('r', 0, hex);
  return render(<LppInspector rawHex={req.rawHex} readings={flat(hex)} restHex={req.restHex} defaultOpen={defaultOpen} />);
}

describe('LppInspector', () => {
  it('is collapsed by default, with the size line in the header', () => {
    renderInspector(PLAN_FIXTURE);
    expect(screen.getByText('Decoded CayenneLPP')).toBeTruthy();
    expect(screen.getByText('42 bytes · 9 readings')).toBeTruthy();
    expect(screen.getByRole('button', { expanded: false })).toBeTruthy();
    expect(screen.queryAllByTestId('lpp-row')).toHaveLength(0);
    expect(screen.queryByText('F6')).toBeNull();
  });

  it('expands to the byte strip and a decoded table (ch, type, name, bytes, value)', () => {
    renderInspector(PLAN_FIXTURE);
    fireEvent.click(screen.getByText('Decoded CayenneLPP'));
    const rows = screen.getAllByTestId('lpp-row');
    expect(rows).toHaveLength(9);
    const cells = Array.from(rows[2].querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(['2', '103', 'Temperature', '02 67 00 F6', '24.6 °C']);
    // One cell per payload byte in the strip.
    expect(screen.getByText('F6')).toBeTruthy();
    expect(screen.getByText('channel')).toBeTruthy();
    expect(screen.getByText('type id')).toBeTruthy();
    expect(screen.getByText('value')).toBeTruthy();
  });

  it('spotlights a record from its bytes or its table row, and explains the value', () => {
    renderInspector(PLAN_FIXTURE, true);
    expect(screen.queryByTestId('lpp-explain')).toBeNull();
    fireEvent.mouseEnter(screen.getByText('F6'));
    expect(screen.getByTestId('lpp-explain').textContent).toBe('ch 2 temp → 0x00F6 = 246 ÷ 10 = 24.6 °C');
    const rows = screen.getAllByTestId('lpp-row');
    expect(rows[2].getAttribute('data-active')).toBe('true');
    expect(rows[3].getAttribute('data-active')).toBeNull();

    fireEvent.mouseEnter(rows[5]);
    expect(screen.getByTestId('lpp-explain').textContent).toBe('ch 2 altitude → 0x00A2 = 162 m');
    fireEvent.mouseLeave(rows[5]);
    expect(screen.queryByTestId('lpp-explain')).toBeNull();
  });

  it('notes zero padding and leaves those bytes out of every record', () => {
    renderInspector('01 74 01 A9 00 00 00 00', true);
    expect(screen.getByText('8 bytes · 1 reading')).toBeTruthy();
    expect(screen.getByText(/4 bytes of zero padding/)).toBeTruthy();
    expect(screen.queryByText(/undecoded/)).toBeNull();
  });

  it('notes an undecoded tail', () => {
    renderInspector('01 74 01 A9 05 FF 12 34', true);
    expect(screen.getByText(/4 undecoded bytes/)).toBeTruthy();
  });

  it('says so when there is no payload', () => {
    render(<LppInspector rawHex={null} readings={[]} defaultOpen />);
    expect(screen.getByText('0 bytes · 0 readings')).toBeTruthy();
    expect(screen.getByText('No payload: the node didn’t reply.')).toBeTruthy();
  });
});

describe('explainReading', () => {
  it('shows signed values with the Unicode minus', () => {
    const readings = flat(INA3221_FIXTURE);
    const current = readings.find((d) => d.reading.ch === 3 && d.reading.typeId === 117);
    if (!current) throw new Error('fixture');
    expect(explainReading(current, hexToBytes(INA3221_FIXTURE) as Uint8Array)).toBe(
      'ch 3 current → 0xFF4A = −182 ÷ 1000 = −0.182 A',
    );
  });

  it('summarises GPS rather than dividing', () => {
    const gps = flat(PLAN_FIXTURE)[1];
    expect(explainReading(gps, hexToBytes(PLAN_FIXTURE) as Uint8Array)).toBe(
      'ch 1 gps → 9 bytes = 30.2114, −97.7622 · altitude 168.40 m · 552 ft',
    );
  });
});
