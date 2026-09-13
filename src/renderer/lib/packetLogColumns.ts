// Packet Log column widths: defaults, limits, and the grid template the header and
// every row share. Pure so the sizing rules are unit-testable in Node.

export type PacketLogColumn = 'time' | 'type' | 'rssi' | 'hop';

/** Widths the user has dragged, in px. A missing column uses its default. */
export type PacketLogColumnWidths = Partial<Record<PacketLogColumn, number>>;

/** Defaults for the fixed columns. `time` is only the fallback: the log measures the
 *  current time format and sizes the column to fit it. Details takes the rest. */
export const DEFAULT_COLUMN_WIDTHS: Record<PacketLogColumn, number> = { time: 70, type: 112, rssi: 92, hop: 30 };

export const MIN_COLUMN_WIDTH = 28;
export const MAX_COLUMN_WIDTH = 480;

export const clampColumnWidth = (w: number) => Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, w)));

/** A column's width: what the user dragged, else the fitted time width for Time, else the default. */
export function columnWidth(column: PacketLogColumn, widths: PacketLogColumnWidths, fittedTimeWidth: number | null): number {
  return widths[column] ?? (column === 'time' && fittedTimeWidth ? fittedTimeWidth : DEFAULT_COLUMN_WIDTHS[column]);
}

/** The CSS grid template for the columns, left to right: time, type, details, rssi, hop. */
export function columnTemplate(widths: PacketLogColumnWidths, fittedTimeWidth: number | null): string {
  const w = (c: PacketLogColumn) => columnWidth(c, widths, fittedTimeWidth);
  return `${w('time')}px ${w('type')}px minmax(0,1fr) ${w('rssi')}px ${w('hop')}px`;
}
