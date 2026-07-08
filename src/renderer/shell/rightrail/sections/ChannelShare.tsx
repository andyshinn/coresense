import QRCode from 'react-qr-code';
import type { Channel } from '../../../../shared/types';
import { CopyButton } from '../../../components/CopyButton';
import { buildChannelShareUri } from '../../../lib/channelShare';
import { Placeholder } from '../atoms';

export function ChannelShareSection({ channel }: { channel: Channel }) {
  const uri = buildChannelShareUri(channel);
  if (!uri || !channel.secretHex) {
    return <Placeholder label="secret unavailable — cannot generate a share code" />;
  }
  return (
    <div className="flex flex-col gap-3 text-cs-text-muted">
      <div className="flex items-center gap-2 text-[11px]">
        <CopyButton value={uri} title="Copy channel link" className="text-cs-accent hover:underline">
          Copy link
        </CopyButton>
        <span aria-hidden className="text-cs-text-dim">
          ·
        </span>
        <CopyButton value={channel.secretHex} title="Copy secret" className="text-cs-accent hover:underline">
          Copy secret
        </CopyButton>
      </div>
      <div className="rounded bg-white p-3">
        <QRCode value={uri} size={256} viewBox="0 0 256 256" style={{ height: 'auto', maxWidth: '100%', width: '100%' }} />
      </div>
    </div>
  );
}
