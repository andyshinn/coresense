// CayenneLPP decoder for MeshCore telemetry replies. Pure (no Node/DOM), so
// main and renderer share one decode: main for the DTOs it serves, the
// renderer for the byte inspector.
//
// Encodings follow electroniccats/CayenneLPP 1.6.1, the library MeshCore
// builds with (platformio.ini). Every record is `[ch][type][data…]`, data
// big-endian. The library's header comments call voltage (116) and current
// (117) unsigned, but its getTypeSigned() returns true for both, and addField
// writes a negative value as two's complement — so both decode as int16 here
// (the PLAN table is wrong on these two). Every other size/multiplier/sign
// below matches CayenneLPP.h/.cpp. Unsigned types lose the sign of a negative
// input (addField stores the magnitude), e.g. INA3221 power `v * c` with a
// negative current arrives as positive watts, and values are truncated, not
// rounded (`uint32 v = value * mult`), so 4.25 V can arrive as 4.24.

export type LppTypeId = number;

export interface GpsValue {
  lat: number;
  lon: number;
  alt: number;
}

export type ReadingValue = number | GpsValue;

export interface Reading {
  /** LPP channel. MeshCore puts self (battery, MCU temp, GPS) on 1, sensors on 2+. */
  ch: number;
  /** LPP type id, e.g. 103 for temperature. */
  typeId: LppTypeId;
  /** Byte offset of this reading's [ch] byte in the payload. */
  offset: number;
  /** Total bytes, including the ch and type bytes. */
  len: number;
  /** Decoded value in the type's base unit (V, A, °C, hPa, m…). GPS is the object form. */
  value: ReadingValue;
}

export interface DecodeResult {
  readings: Reading[];
  /** Undecoded tail (unknown type id or truncated record); empty when fully decoded. */
  rest: Uint8Array;
}

export interface LppType {
  id: LppTypeId;
  /** Display name, e.g. "Temperature". */
  name: string;
  /** Short lowercase type name for meta lines ("temp · 103"). */
  short: string;
  /** Data bytes after the ch + type header. */
  len: number;
  /** Value resolution in `unit`. For GPS this is the lat/lon step (alt is 0.01 m). */
  step: number;
  /** Decimals that `step` implies; the formatter's default precision. */
  decimals: number;
  signed: boolean;
  /** Base unit of the decoded value; '' for unitless. */
  unit: string;
  /** lucide-react icon export name. */
  icon: string;
  decode: (data: Uint8Array) => ReadingValue;
}

// Big-endian integer of `data` (1–4 bytes), two's complement when `signed`.
function readInt(data: Uint8Array, start: number, size: number, signed: boolean): number {
  let v = 0;
  for (let i = 0; i < size; i += 1) v = v * 256 + data[start + i];
  if (signed && v >= 2 ** (size * 8 - 1)) v -= 2 ** (size * 8);
  return v;
}

// Divide by the library's integer multiplier rather than multiplying by the
// step: 246 / 10 gives 24.6, while 246 * 0.1 gives 24.600000000000001.
function scalar(size: number, mult: number, signed: boolean): (data: Uint8Array) => number {
  return (data) => readInt(data, 0, size, signed) / mult;
}

function decodeGps(data: Uint8Array): GpsValue {
  return {
    lat: readInt(data, 0, 3, true) / 10_000,
    lon: readInt(data, 3, 3, true) / 10_000,
    alt: readInt(data, 6, 3, true) / 100,
  };
}

type TypeSpec = Omit<LppType, 'decode' | 'step' | 'decimals'> & { mult: number };

const SPECS: TypeSpec[] = [
  { id: 0, name: 'Digital input', short: 'digital in', len: 1, mult: 1, signed: false, unit: '', icon: 'Binary' },
  { id: 2, name: 'Analog input', short: 'analog in', len: 2, mult: 100, signed: true, unit: '', icon: 'CircleGauge' },
  { id: 100, name: 'Generic sensor', short: 'generic', len: 4, mult: 1, signed: false, unit: '', icon: 'Wind' },
  { id: 101, name: 'Luminosity', short: 'luminosity', len: 2, mult: 1, signed: false, unit: 'lux', icon: 'Sun' },
  { id: 103, name: 'Temperature', short: 'temp', len: 2, mult: 10, signed: true, unit: '°C', icon: 'Thermometer' },
  { id: 104, name: 'Humidity', short: 'humidity', len: 1, mult: 2, signed: false, unit: '%', icon: 'Droplet' },
  { id: 115, name: 'Pressure', short: 'barometer', len: 2, mult: 10, signed: false, unit: 'hPa', icon: 'Gauge' },
  { id: 116, name: 'Voltage', short: 'voltage', len: 2, mult: 100, signed: true, unit: 'V', icon: 'Zap' },
  { id: 117, name: 'Current', short: 'current', len: 2, mult: 1000, signed: true, unit: 'A', icon: 'Plug' },
  { id: 118, name: 'Frequency', short: 'frequency', len: 4, mult: 1, signed: false, unit: 'Hz', icon: 'Waves' },
  { id: 120, name: 'Percentage', short: 'percentage', len: 1, mult: 1, signed: false, unit: '%', icon: 'Percent' },
  { id: 121, name: 'Altitude', short: 'altitude', len: 2, mult: 1, signed: true, unit: 'm', icon: 'Mountain' },
  { id: 125, name: 'Concentration', short: 'concentration', len: 2, mult: 1, signed: false, unit: 'ppm', icon: 'Cloud' },
  { id: 128, name: 'Power', short: 'power', len: 2, mult: 1, signed: false, unit: 'W', icon: 'Power' },
  { id: 130, name: 'Distance', short: 'distance', len: 4, mult: 1000, signed: false, unit: 'm', icon: 'Ruler' },
  { id: 136, name: 'GPS', short: 'gps', len: 9, mult: 10_000, signed: true, unit: '°', icon: 'MapPin' },
  { id: 142, name: 'Switch', short: 'switch', len: 1, mult: 1, signed: false, unit: '', icon: 'ToggleLeft' },
];

/** The single LPP type registry: id → name, size, resolution, sign, unit, icon and decoder. */
export const LPP_TYPES: Readonly<Record<LppTypeId, LppType>> = Object.freeze(
  Object.fromEntries(
    SPECS.map(({ mult, ...spec }): [number, LppType] => [
      spec.id,
      Object.freeze({
        ...spec,
        step: 1 / mult,
        // mult 2 (humidity, 0.5 %) needs one decimal, so round up.
        decimals: Math.max(0, Math.ceil(Math.log10(mult) - 1e-9)),
        decode: spec.id === 136 ? decodeGps : scalar(spec.len, mult, spec.signed),
      }),
    ]),
  ),
);

export function lppType(typeId: LppTypeId): LppType | undefined {
  return LPP_TYPES[typeId];
}

export function isGpsValue(value: ReadingValue): value is GpsValue {
  return typeof value === 'object' && value !== null;
}

const EMPTY = new Uint8Array(0);

function allZero(bytes: Uint8Array, from: number): boolean {
  for (let i = from; i < bytes.length; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

/**
 * Decode a CayenneLPP payload. Never throws: payloads come off the air.
 *
 * - An unknown type id or a truncated record stops the decode; `rest` holds the
 *   bytes from that record's [ch] byte on, and earlier readings are kept.
 * - Mesh replies are zero-padded to the 16-byte AES block (MeshCore
 *   Utils.cpp encrypt). At a record boundary, if every remaining byte is 0x00
 *   the tail is padding: stop with `rest` empty. Stripping zeros up front would
 *   be wrong, since a last value can legitimately end in 00 (altitude 0,
 *   VL53L0X out-of-range distance 0). MeshCore never uses ch 0.
 */
export function decodeLpp(bytes: Uint8Array): DecodeResult {
  const readings: Reading[] = [];
  if (!(bytes instanceof Uint8Array)) return { readings, rest: EMPTY };
  let i = 0;
  while (i < bytes.length) {
    if (allZero(bytes, i)) return { readings, rest: EMPTY };
    const type = i + 1 < bytes.length ? LPP_TYPES[bytes[i + 1]] : undefined;
    if (!type || i + 2 + type.len > bytes.length) break;
    const data = bytes.subarray(i + 2, i + 2 + type.len);
    readings.push({ ch: bytes[i], typeId: type.id, offset: i, len: 2 + type.len, value: type.decode(data) });
    i += 2 + type.len;
  }
  // Copy into a plain Uint8Array: main passes a Node Buffer, whose slice() is
  // a view that would alias (and pin) the reply's possibly pooled memory.
  return { readings, rest: new Uint8Array(bytes.subarray(i)) };
}

/** Lowercase hex of `bytes`, no separators. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Parse a hex string (whitespace ignored). Returns null for odd length or non-hex input. */
export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
