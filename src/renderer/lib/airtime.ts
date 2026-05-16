import type { RadioSettings } from '../../shared/types';

// Semtech LoRa airtime, in milliseconds. The classic formula from AN1200.13:
//   T_sym       = (2^SF) / BW
//   T_preamble  = (n_preamble + 4.25) * T_sym
//   payload_sym = 8 + max(ceil((8*PL - 4*SF + 28 + 16*CRC - 20*IH) / (4*(SF - 2*DE))) * (CR + 4), 0)
//   T_payload   = payload_sym * T_sym
//   T_packet    = T_preamble + T_payload
//
// Defaults match MeshCore firmware (preamble=8, header, CRC on, no low-data-rate
// optimisation unless SF >= 11 with BW <= 125 kHz).
export function loraAirtimeMs(payloadBytes: number, settings: RadioSettings): number {
  const sf = settings.spreadingFactor;
  const bw = settings.bandwidthHz;
  const cr = settings.codingRate; // 5..8 → CR 4/5..4/8
  if (sf < 6 || sf > 12 || bw <= 0 || payloadBytes < 0) return 0;

  const tSym = 2 ** sf / bw; // seconds
  const nPreamble = 8;
  const tPreamble = (nPreamble + 4.25) * tSym;
  const crBits = cr - 4; // 1..4
  const headerImplicit = 0; // explicit header (IH = 0)
  const crcOn = 1;
  const lowDataRateOpt = sf >= 11 && bw <= 125_000 ? 1 : 0;

  const numerator = 8 * payloadBytes - 4 * sf + 28 + 16 * crcOn - 20 * headerImplicit;
  const denominator = 4 * (sf - 2 * lowDataRateOpt);
  const payloadSymbols = 8 + Math.max(Math.ceil(numerator / denominator) * (crBits + 4), 0);
  const tPayload = payloadSymbols * tSym;
  return (tPreamble + tPayload) * 1000;
}
