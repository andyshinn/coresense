import { firstPathStats } from '../../../../shared/messagePath';
import type { Message } from '../../../../shared/types';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useStore } from '../../../lib/store';
import { fmtDateTime, messageClockSkew, RECEIVED_LABEL, SENDER_CLOCK_LABEL } from '../../../lib/time';

/** Per-message metadata: received + sender-clock times, state, sender, RSSI/SNR/hops, signature. */
export function MessageInfoSection({ message }: { message: Message }) {
  const timeFormat = useStore((s) => s.appSettings.timeFormat);
  // Same derivation as the message row's own hop chip. Gating this row on the
  // bare `meta.hops` scalar meant it never rendered at all — nothing writes it.
  const hops = firstPathStats(message).hops;
  const skew = messageClockSkew(message);
  return (
    <div className="space-y-1.5 text-cs-text-muted">
      {message.sentTs == null ? (
        <KeyValueRow label="Time" value={fmtDateTime(message.ts, timeFormat)} mono />
      ) : (
        <>
          <KeyValueRow
            label={RECEIVED_LABEL}
            value={fmtDateTime(message.ts, timeFormat)}
            title="When this app received it — messages are listed in this order"
            mono
          />
          <KeyValueRow
            label={SENDER_CLOCK_LABEL}
            value={fmtDateTime(message.sentTs, timeFormat)}
            title="The timestamp inside the packet, from the sending node's own clock — often wrong"
            mono
          />
          {skew && <KeyValueRow label="Skew" value={skew} title="Sender clock minus received time" mono />}
        </>
      )}
      <KeyValueRow label="State" value={message.state} mono />
      <KeyValueRow label="From" value={message.fromPublicKeyHex ?? '(self)'} mono />
      {message.meta?.rssi != null && <KeyValueRow label="RSSI" value={`${message.meta.rssi} dBm`} mono />}
      {message.meta?.snr != null && <KeyValueRow label="SNR" value={`${message.meta.snr} dB`} mono />}
      {hops != null && <KeyValueRow label="Hops" value={String(hops)} mono />}
      {message.meta?.signatureHex && <KeyValueRow label="Sig" value={`${message.meta.signatureHex.slice(0, 16)}…`} mono />}
    </div>
  );
}
