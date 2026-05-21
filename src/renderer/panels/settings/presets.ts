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
