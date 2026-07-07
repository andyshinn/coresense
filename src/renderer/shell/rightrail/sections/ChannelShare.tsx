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
    <div className="flex flex-col gap-2 text-cs-text-muted">
      <div className="flex items-center gap-3">
        <div className="rounded bg-white p-1.5">
          <QRCode value={uri} size={72} />
        </div>
        <div className="flex flex-col gap-1 text-[11px]">
          <CopyButton value={uri} title="Copy channel link" className="text-cs-accent hover:underline">
            Copy link
          </CopyButton>
          <CopyButton value={channel.secretHex} title="Copy secret" className="text-cs-text-dim hover:text-cs-text">
            Copy secret
          </CopyButton>
        </div>
      </div>
      <p className="text-[10px] text-cs-text-dim">Anyone with this code can read and post to the channel.</p>
    </div>
  );
}
