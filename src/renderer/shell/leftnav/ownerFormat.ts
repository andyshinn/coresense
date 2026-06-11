/** Frequency in Hz as MHz with three decimals, no unit (e.g. "910.525"). */
export function fmtFreqMhz(hz: number): string {
  return (hz / 1e6).toFixed(3);
}
/** Frequency in Hz formatted as MHz with a unit (e.g. "910.525 MHz"). */
export function fmtFreq(hz: number): string {
  return `${fmtFreqMhz(hz)} MHz`;
}
/** Bandwidth in Hz formatted as kHz. */
export function fmtBandwidth(hz: number): string {
  return `${hz / 1000} kHz`;
}
/** Storage in KB formatted as MB once it crosses the threshold. */
export function fmtStorageKb(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}
/** GPS interval seconds formatted as minutes when an even minute. */
export function fmtGpsInterval(sec: number): string {
  return sec % 60 === 0 ? `${sec / 60} min` : `${sec}s`;
}
