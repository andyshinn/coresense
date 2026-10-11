import { describe, expect, it } from 'vitest';
import {
  fmtAge,
  fmtDuration,
  fmtFahrenheit,
  fmtFeet,
  fmtSeconds,
  formatNumber,
  GROUP_SEP,
  MINUS,
  unicodeMinus,
  withUnit,
} from '../../../../src/shared/telemetry/format';

describe('formatNumber', () => {
  it('uses the Unicode minus and never shows a negative zero', () => {
    expect(formatNumber(-20, 1)).toBe(`${MINUS}20.0`);
    expect(formatNumber(-0.001, 2)).toBe('0.00');
    expect(formatNumber(4.25, 2)).toBe('4.25');
  });

  it('groups integers from 1000 when asked', () => {
    expect(formatNumber(48211, 0, { group: true })).toBe(`48${GROUP_SEP}211`);
    expect(formatNumber(999, 0, { group: true })).toBe('999');
    expect(formatNumber(1013.4, 1, { group: true })).toBe('1013.4');
    expect(formatNumber(-1234567, 0, { group: true })).toBe(`${MINUS}1${GROUP_SEP}234${GROUP_SEP}567`);
  });

  it('renders non-finite values as a dash', () => {
    expect(formatNumber(Number.NaN, 1)).toBe('—');
  });
});

describe('withUnit', () => {
  it('spaces units, attaches %', () => {
    expect(withUnit('4.25', 'V')).toBe('4.25 V');
    expect(withUnit('1013.4', 'hPa')).toBe('1013.4 hPa');
    expect(withUnit('58.5', '%')).toBe('58.5%');
    expect(withUnit('3', '')).toBe('3');
  });
});

describe('imperial secondaries', () => {
  it('converts °C and metres', () => {
    expect(fmtFahrenheit(24.6)).toBe('76.3 °F');
    expect(fmtFeet(162)).toBe('531 ft');
  });

  it('unicodeMinus swaps hyphen-minus before digits only', () => {
    expect(unicodeMinus('30.2114, -97.7622')).toBe(`30.2114, ${MINUS}97.7622`);
    expect(unicodeMinus('a-b')).toBe('a-b');
    expect(unicodeMinus('-3.3 °C')).toBe(`${MINUS}3.3 °C`);
    expect(unicodeMinus('-.5')).toBe(`${MINUS}.5`);
    expect(unicodeMinus('2026-10-10 · BME-680 · 10-20')).toBe('2026-10-10 · BME-680 · 10-20');
  });
});

describe('fmtDuration', () => {
  it('shows the two largest units', () => {
    expect(fmtDuration((2 * 60 + 14) * 60_000)).toBe('2 h 14 m');
    expect(fmtDuration((4 * 24 + 4) * 3_600_000)).toBe('4 d 4 h');
    expect(fmtDuration((34 * 3600 + 5 * 60) * 1000)).toBe('1 d 10 h');
    expect(fmtDuration(45_000)).toBe('45 s');
    expect(fmtDuration(125_000)).toBe('2 m 5 s');
  });

  it('drops a zero second unit and handles tiny or negative spans', () => {
    expect(fmtDuration(2 * 3_600_000)).toBe('2 h');
    expect(fmtDuration(500)).toBe('0 s');
    expect(fmtDuration(-90_000)).toBe('1 m 30 s');
    expect(fmtDuration(Number.POSITIVE_INFINITY)).toBe('—');
    expect(fmtDuration(Number.NaN)).toBe('—');
  });
});

describe('fmtAge', () => {
  const now = 1_000_000_000_000;

  it('is seconds-precise in the largest unit', () => {
    expect(fmtAge(now - 12_000, now)).toBe('12 s ago');
    expect(fmtAge(now - 4 * 60_000 - 59_000, now)).toBe('4 m ago');
    expect(fmtAge(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(fmtAge(now - 26 * 3_600_000, now)).toBe('1 d ago');
  });

  it('says just now under a second and for future timestamps', () => {
    expect(fmtAge(now - 400, now)).toBe('just now');
    expect(fmtAge(now + 5_000, now)).toBe('just now');
  });
});

describe('fmtSeconds', () => {
  it('formats a round trip', () => {
    expect(fmtSeconds(1840)).toBe('1.8 s');
  });
});
