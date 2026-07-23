export interface Macro {
  label: string;
  text: string;
}

/** Roadmap seed macros — shown as a "soon" preview until the macros feature lands. */
export const SEED_MACROS: readonly Macro[] = [
  { label: 'ACK', text: 'ack ✓ heard you, thanks' },
  { label: 'Copy that', text: 'copy that' },
  { label: 'SNR?', text: 'what SNR are you seeing on your end?' },
  { label: 'Relaying', text: 'relaying now' },
  { label: 'QSY 910.5', text: 'QSY 910.5 MHz' },
  { label: 'ETA', text: 'ETA ~10 min' },
];
