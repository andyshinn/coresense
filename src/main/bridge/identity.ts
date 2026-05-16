// Stable client identity for inbox-replay bookkeeping.
//
// MeshCore APP_START (cmd 0x01) payload:
//   [0x01][version u8][6 reserved bytes][app name as UTF-8]
// e.g. "01 01 00 00 00 00 00 00 6d6573686 36f72652d 666c7574746572" → "meshcore-flutter".
//
// The app name alone is not unique — every official Flutter client announces
// itself as "meshcore-flutter". The IP alone is not unique either when distinct
// client kinds run on the same machine. Pair them.

const APP_START_HEADER_LEN = 8;

export function parseAppStartName(payload: Buffer): string | null {
  if (payload.length <= APP_START_HEADER_LEN) return null;
  if (payload[0] !== 0x01) return null;
  const tail = payload.subarray(APP_START_HEADER_LEN);
  let end = tail.length;
  while (end > 0 && tail[end - 1] === 0) end -= 1;
  if (end === 0) return null;
  const name = tail.subarray(0, end).toString('utf8').trim();
  return name.length > 0 ? name : null;
}

export function inboxKeyFor(ip: string | null, appName: string | null): string {
  return `${ip ?? '_'}:${appName ?? '_'}`;
}

// RESP_SELF_INFO carries the local node's display name as printable ASCII at
// the very end of the payload. The 32B pubkey + ~25B firmware/radio metadata
// in front of it reliably contains non-printable bytes (zeros, control chars,
// random key bytes) so a trailing-printable scan finds the name without us
// having to know the exact firmware-version-specific header layout.
export function parseNodeNameFromSelfInfo(frame: Buffer): string | null {
  if (frame.length < 2 || frame[0] !== 0x05) return null;
  let start = frame.length;
  while (start > 1) {
    const b = frame[start - 1];
    if (b >= 0x20 && b < 0x7f) {
      start -= 1;
    } else {
      break;
    }
  }
  const name = frame.subarray(start).toString('utf8').trim();
  return name.length > 0 ? name : null;
}
