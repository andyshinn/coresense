// Round-trip airtime estimate. Wraps loraAirtimeMs following the shipped caller
// (Composer.tsx:106, which adds `+ 32 /* rough wrapper overhead */`): the
// outbound leg is byteLength(command) + 32, the inbound leg is 160 + 32 (a
// single reply frame ≤160 B, §0), each multiplied by hop count since every hop
// retransmits. noReply counts the outbound leg only.
import type { RadioSettings } from '../../../../../shared/types';
import { loraAirtimeMs } from '../../../../lib/airtime';

const WRAPPER = 32; // rough transport wrapper overhead (Composer.tsx:106)
const REPLY_BYTES = 160; // one reply frame ≤160 B (§0)

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function cliRoundTrip(
  command: string,
  radio: RadioSettings | null | undefined,
  hops: number,
  noReply: boolean,
): { ms: number; label: string } {
  if (!radio) return { ms: 0, label: '—' };

  const legs = Math.max(1, hops);
  const out = loraAirtimeMs(byteLength(command) + WRAPPER, radio) * legs;
  const inbound = noReply ? 0 : loraAirtimeMs(REPLY_BYTES + WRAPPER, radio) * legs;
  const ms = out + inbound;
  if (ms <= 0) return { ms: 0, label: '—' };

  const secs = ms / 1000;
  const label = secs < 10 ? `~${secs.toFixed(1)} s` : `~${Math.round(secs)} s`;
  return { ms, label };
}
