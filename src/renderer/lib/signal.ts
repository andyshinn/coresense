// Signal-quality helpers shared by the path viewer, the map, the packet log and
// the RSSI chip.
//
// The two RSSI scales are deliberately separate. BLE RSSI measures how close the
// host is to its companion radio; LoRa RSSI measures an over-the-air reception,
// which is routinely far weaker. Grading one on the other's thresholds would
// read a healthy mesh link as dead, or a weak BLE link as strong.

/** Coarse SNR classification used to pick a colour token. */
export function snrBand(snr: number): 'strong' | 'mid' | 'weak' {
  if (snr >= 5) return 'strong';
  if (snr >= 0) return 'mid';
  return 'weak';
}

/** CSS custom property name encoding the SNR band's colour. */
export function snrTokenVar(snr: number): string {
  const b = snrBand(snr);
  if (b === 'strong') return '--cs-online';
  if (b === 'mid') return '--cs-warn';
  return '--cs-danger';
}

/** Format an SNR reading as a 2-decimal dB string. */
export function fmtSnr(s: number): string {
  return `${s.toFixed(2)}dB`;
}

/** Fixed SNR band colours (hex), matching the --cs-online/--cs-warn/--cs-danger
 *  tokens. Used where a concrete colour string is required — e.g. MapLibre paint,
 *  which can't resolve CSS custom properties. Bands are semantic and
 *  theme-independent, so hard-coding the hexes keeps them in sync with the
 *  SignalBars gauge by construction. */
export function snrColor(snr: number): string {
  const b = snrBand(snr);
  if (b === 'strong') return '#84cc16';
  if (b === 'mid') return '#f59e0b';
  return '#dc2626';
}

/** BLE RSSI (dBm) → bars (0..4). MeshCore radios in BLE proximity typically run
 *  -30 to -90 dBm; below -95 is essentially unusable. */
export function bleRssiBars(rssi: number): number {
  if (rssi >= -55) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -85) return 2;
  if (rssi >= -95) return 1;
  return 0;
}

/** Text colour class grading a LoRa reception's RSSI (dBm) in the packet log. */
export function loraRssiClass(rssi?: number): string {
  if (rssi == null) return 'text-cs-text-dim';
  if (rssi > -80) return 'text-cs-online';
  if (rssi > -96) return 'text-cs-text-muted';
  return 'text-cs-warn';
}
