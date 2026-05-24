import type { Message } from '../../../../shared/types';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useStore } from '../../../lib/store';
import { fmtDateTime } from '../../../lib/time';

/** Per-message metadata: time, state, sender, RSSI/SNR/hops, signature. */
export function MessageInfoSection({ message }: { message: Message }) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <KeyValueRow label="Time" value={fmtDateTime(message.ts, timeFormat)} mono />
      <KeyValueRow label="State" value={message.state} mono />
      <KeyValueRow label="From" value={message.fromPublicKeyHex ?? '(self)'} mono />
      {message.meta?.rssi != null && (
        <KeyValueRow label="RSSI" value={`${message.meta.rssi} dBm`} mono />
      )}
      {message.meta?.snr != null && (
        <KeyValueRow label="SNR" value={`${message.meta.snr} dB`} mono />
      )}
      {message.meta?.hops != null && (
        <KeyValueRow label="Hops" value={String(message.meta.hops)} mono />
      )}
      {message.meta?.signatureHex && (
        <KeyValueRow label="Sig" value={`${message.meta.signatureHex.slice(0, 16)}…`} mono />
      )}
    </div>
  );
}
