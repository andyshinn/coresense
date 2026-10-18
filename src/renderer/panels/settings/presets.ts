// Regional LoRa presets matching the official mobile app's "Select Radio
// Settings" sheet. Sourced from
// /Users/andy/GitHub/zjs81/meshcore-open/lib/models/radio_settings.dart.
// Frequencies in Hz, bandwidth in Hz, codingRate as the LoRa denominator
// suffix (5..8 = 4/5..4/8).

export interface RadioPreset {
  id: string;
  label: string;
  frequencyHz: number;
  bandwidthHz: number;
  spreadingFactor: number;
  codingRate: number;
  /** Default TX power in dBm. Regulatory caps drive these. */
  txPowerDbm: number;
}

export const RADIO_PRESETS: RadioPreset[] = [
  {
    id: 'usa-canada',
    label: 'USA/Canada (Recommended)',
    frequencyHz: 910_525_000,
    bandwidthHz: 62_500,
    spreadingFactor: 7,
    codingRate: 5,
    txPowerDbm: 20,
  },
  {
    id: 'eu-uk-narrow',
    label: 'EU/UK (Narrow)',
    frequencyHz: 869_618_000,
    bandwidthHz: 62_500,
    spreadingFactor: 8,
    codingRate: 8,
    txPowerDbm: 14,
  },
  {
    id: 'eu-uk-deprecated',
    label: 'EU/UK (Deprecated)',
    frequencyHz: 869_525_000,
    bandwidthHz: 250_000,
    spreadingFactor: 11,
    codingRate: 5,
    txPowerDbm: 14,
  },
  {
    id: 'australia',
    label: 'Australia',
    frequencyHz: 915_800_000,
    bandwidthHz: 250_000,
    spreadingFactor: 10,
    codingRate: 5,
    txPowerDbm: 20,
  },
  {
    id: 'australia-narrow',
    label: 'Australia (Narrow)',
    frequencyHz: 916_575_000,
    bandwidthHz: 62_500,
    spreadingFactor: 7,
    codingRate: 8,
    txPowerDbm: 20,
  },
  {
    id: 'australia-mid',
    label: 'Australia (Mid)',
    frequencyHz: 915_075_000,
    bandwidthHz: 125_000,
    spreadingFactor: 9,
    codingRate: 5,
    txPowerDbm: 20,
  },
  {
    id: 'australia-sa-wa',
    label: 'Australia: SA, WA',
    frequencyHz: 923_125_000,
    bandwidthHz: 62_500,
    spreadingFactor: 8,
    codingRate: 8,
    txPowerDbm: 20,
  },
  {
    id: 'australia-qld',
    label: 'Australia: QLD',
    frequencyHz: 923_125_000,
    bandwidthHz: 62_500,
    spreadingFactor: 8,
    codingRate: 5,
    txPowerDbm: 20,
  },
  {
    id: 'czech-republic-narrow',
    label: 'Czech Republic (Narrow)',
    frequencyHz: 869_432_000,
    bandwidthHz: 62_500,
    spreadingFactor: 7,
    codingRate: 5,
    txPowerDbm: 14,
  },
  {
    id: 'eu-433-long-range',
    label: 'EU 433MHz (Long Range)',
    frequencyHz: 433_650_000,
    bandwidthHz: 250_000,
    spreadingFactor: 11,
    codingRate: 5,
    txPowerDbm: 10,
  },
  {
    id: 'eu-433-narrow',
    label: 'EU 433MHz (Narrow)',
    frequencyHz: 433_650_000,
    bandwidthHz: 62_500,
    spreadingFactor: 8,
    codingRate: 8,
    txPowerDbm: 10,
  },
  {
    id: 'new-zealand',
    label: 'New Zealand',
    frequencyHz: 917_375_000,
    bandwidthHz: 250_000,
    spreadingFactor: 11,
    codingRate: 5,
    txPowerDbm: 20,
  },
  {
    id: 'new-zealand-narrow',
    label: 'New Zealand (Narrow)',
    frequencyHz: 917_375_000,
    bandwidthHz: 62_500,
    spreadingFactor: 7,
    codingRate: 5,
    txPowerDbm: 20,
  },
  {
    id: 'portugal-433',
    label: 'Portugal 433',
    frequencyHz: 433_375_000,
    bandwidthHz: 62_500,
    spreadingFactor: 9,
    codingRate: 6,
    txPowerDbm: 10,
  },
  {
    id: 'portugal-868',
    label: 'Portugal 868',
    frequencyHz: 869_618_000,
    bandwidthHz: 62_500,
    spreadingFactor: 7,
    codingRate: 6,
    txPowerDbm: 14,
  },
  {
    id: 'switzerland',
    label: 'Switzerland',
    frequencyHz: 869_618_000,
    bandwidthHz: 62_500,
    spreadingFactor: 8,
    codingRate: 8,
    txPowerDbm: 14,
  },
  {
    id: 'vietnam-narrow',
    label: 'Vietnam (Narrow)',
    frequencyHz: 920_250_000,
    bandwidthHz: 62_500,
    spreadingFactor: 8,
    codingRate: 5,
    txPowerDbm: 20,
  },
  {
    id: 'vietnam-deprecated',
    label: 'Vietnam (Deprecated)',
    frequencyHz: 920_250_000,
    bandwidthHz: 250_000,
    spreadingFactor: 11,
    codingRate: 5,
    txPowerDbm: 20,
  },
];

export function findMatchingPreset(opts: {
  frequencyHz: number;
  bandwidthHz: number;
  spreadingFactor: number;
  codingRate: number;
}): RadioPreset | undefined {
  return RADIO_PRESETS.find(
    (p) =>
      p.frequencyHz === opts.frequencyHz &&
      p.bandwidthHz === opts.bandwidthHz &&
      p.spreadingFactor === opts.spreadingFactor &&
      p.codingRate === opts.codingRate,
  );
}

type Option = { value: number; label: string };

/** LoRa bandwidths the radio accepts, in Hz. */
export const BANDWIDTH_OPTIONS = [
  { value: 7800, label: '7.8 kHz' },
  { value: 10400, label: '10.4 kHz' },
  { value: 15600, label: '15.6 kHz' },
  { value: 20800, label: '20.8 kHz' },
  { value: 31250, label: '31.25 kHz' },
  { value: 41700, label: '41.7 kHz' },
  { value: 62500, label: '62.5 kHz' },
  { value: 125000, label: '125 kHz' },
  { value: 250000, label: '250 kHz' },
  { value: 500000, label: '500 kHz' },
] satisfies Option[];

export const SPREADING_FACTOR_OPTIONS = [
  { value: 7, label: 'SF7 (fastest)' },
  { value: 8, label: 'SF8' },
  { value: 9, label: 'SF9' },
  { value: 10, label: 'SF10' },
  { value: 11, label: 'SF11' },
  { value: 12, label: 'SF12 (longest range)' },
] satisfies Option[];

/** Coding rate as the LoRa denominator suffix: 5 = 4/5 … 8 = 4/8. */
export const CODING_RATE_OPTIONS = [
  { value: 5, label: '4/5' },
  { value: 6, label: '4/6' },
  { value: 7, label: '4/7' },
  { value: 8, label: '4/8' },
] satisfies Option[];
