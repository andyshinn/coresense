import { Megaphone } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useCurrentNode } from '../../../features/my-node/currentNode';
import { useNowTick } from '../../../hooks/useNowTick';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { fmtRelative } from '../../../lib/time';
import { NodeCard } from '../NodeCard';

/** Self-adverts: when CoreSense last sent one, whether adverts carry the
 *  position, and the two advert buttons. The radio doesn't report adverts sent
 *  from its own button, so the last one is the last one sent from here. */
export function AdvertCard({ className }: { className?: string }) {
  const client = useApiClient();
  const connected = useStore((s) => s.transportState === 'connected');
  const shared = useStore((s) => s.deviceIdentity.sharePositionInAdvert);
  const entry = useCurrentNode();
  const now = useNowTick(30_000);
  const [sending, setSending] = useState(false);
  const last = entry?.lastSelfAdvert ?? null;

  const send = async (flood: boolean) => {
    if (!client) return;
    setSending(true);
    try {
      await api.sendAdvert(client, flood);
      notify.success('Self-advert sent');
    } catch (err) {
      notify.failure('Self-advert', err);
    } finally {
      setSending(false);
    }
  };

  const disabled = !connected || !client || sending;

  return (
    <NodeCard icon={Megaphone} title="Advert activity" className={className}>
      <div className="flex flex-col gap-1">
        <KeyValueRow
          label="Last self-advert"
          labelTone="muted"
          mono
          title="The last self-advert sent from CoreSense. Adverts from the radio's own button aren't reported."
          value={last ? `${fmtRelative(last.at, now)} · ${last.flood ? 'Flood' : 'Zero-hop'}` : 'None sent from CoreSense'}
        />
        <KeyValueRow label="Position in advert" labelTone="muted" mono value={shared ? 'Shared' : 'Not shared'} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="xs" onClick={() => void send(true)} disabled={disabled}>
          Flood advert
        </Button>
        <Button variant="outline" size="xs" onClick={() => void send(false)} disabled={disabled}>
          Zero-hop advert
        </Button>
      </div>
    </NodeCard>
  );
}
