import type { ReactNode } from 'react';
import type { Message } from '../../../shared/types';
import { KeyValueRow } from '../../components/ui/KeyValueRow';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { firstPathStats } from '../../lib/messagePath';

interface Props {
  message: Message;
  senderName: string; // '' for self/unknown
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function MessageInfoPopover({ message, senderName, open, onOpenChange, children }: Props) {
  const isSelf = message.fromPublicKeyHex === undefined;
  const { hops } = firstPathStats(message);
  const pk = message.fromPublicKeyHex;
  const showPk = pk != null && pk !== 'unknown' && !pk.startsWith('name:');
  const rssi = message.meta?.rssi;
  const snr = message.meta?.snr;
  const pathHops = message.meta?.paths?.[0]?.hops ?? [];

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[288px] border-cs-border-strong bg-cs-bg-2 p-3">
        <div className="mb-2.5 text-[10px] uppercase tracking-wider text-cs-text-dim">Message info</div>
        <div className="mb-3 rounded-md border border-cs-border bg-cs-bg-3 px-2.5 py-2 text-[12px] leading-relaxed text-cs-text">
          {message.body}
        </div>
        <div className="rounded-md border border-cs-border">
          <KeyValueRow label="From" value={isSelf ? 'You' : senderName || '(unknown)'} />
          {showPk && <KeyValueRow label="Public key" value={pk} mono />}
          {hops != null && <KeyValueRow label="Hops" value={String(hops)} mono />}
          {(rssi != null || snr != null) && (
            <KeyValueRow
              label="RSSI / SNR"
              value={`${rssi != null ? `${rssi} dBm` : '—'} · ${snr != null ? `${snr > 0 ? '+' : ''}${snr} dB` : '—'}`}
              mono
            />
          )}
          <KeyValueRow label="State" value={message.state} mono />
        </div>
        {pathHops.length > 0 && (
          <>
            <div className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-cs-text-dim">Path</div>
            <div className="flex flex-col gap-1">
              {pathHops.map((h, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: hops can repeat shortId; index disambiguates
                  key={`${i}.${h.shortId}`}
                  className="flex items-center gap-2 rounded-md border border-cs-border bg-cs-bg-3 px-2 py-1.5"
                >
                  <span className="font-mono text-[10px] text-cs-text-dim">{i + 1}</span>
                  <span className="flex-1 truncate font-mono text-[11px] text-cs-text">{h.name ?? h.shortId}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
