import { describe, expect, it } from 'vitest';
import {
  clampColumnWidth,
  columnTemplate,
  columnWidth,
  DEFAULT_COLUMN_WIDTHS,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from '../../../../src/renderer/lib/packetLogColumns';

describe('packet log column widths', () => {
  it('uses the defaults, with details taking the remaining space', () => {
    expect(columnTemplate({}, null)).toBe('70px 112px minmax(0,1fr) 92px 30px');
  });

  it('sizes the time column to the measured time format until the user drags it', () => {
    expect(columnWidth('time', {}, 78)).toBe(78);
    expect(columnWidth('time', { time: 140 }, 78)).toBe(140);
    // The fitted width only applies to Time.
    expect(columnWidth('type', {}, 78)).toBe(DEFAULT_COLUMN_WIDTHS.type);
  });

  it('applies dragged widths in column order', () => {
    expect(columnTemplate({ type: 150, rssi: 120, hop: 40 }, 57)).toBe('57px 150px minmax(0,1fr) 120px 40px');
  });

  it('clamps and rounds a dragged width', () => {
    expect(clampColumnWidth(3)).toBe(MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(10_000)).toBe(MAX_COLUMN_WIDTH);
    expect(clampColumnWidth(101.6)).toBe(102);
  });
});
