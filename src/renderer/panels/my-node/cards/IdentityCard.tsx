import { Copy, KeyRound, Share2 } from 'lucide-react';
import { useEffect } from 'react';
import QRCode from 'react-qr-code';
import { CopyButton } from '../../../components/CopyButton';
import { buttonVariants } from '../../../components/ui/button';
import { useCurrentNode } from '../../../features/my-node/currentNode';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { useStore } from '../../../lib/store';
import { cn } from '../../../lib/utils';
import { NodeCard } from '../NodeCard';

/** `1a3d3c…2b7e`: enough of the key to recognise, the full key in `title`. */
export function shortKey(hex: string): string {
  return hex.length > 10 ? `${hex.slice(0, 6)}…${hex.slice(-4)}` : hex;
}

/** The radio's contact QR and link (its own signed advert), and its public
 *  key. Works offline from the node cache, as long as the cached advert is
 *  still current (main drops it when the name or position changes). */
export function IdentityCard({ className }: { className?: string }) {
  const client = useApiClient();
  const connected = useStore((s) => s.transportState === 'connected');
  const owner = useStore((s) => s.owner);
  const entry = useCurrentNode();
  const publicKey = (connected ? owner?.publicKeyHex : null) ?? entry?.publicKeyHex ?? null;
  const advertHex = entry?.advertLinkHex ?? null;
  const uri = advertHex ? `meshcore://${advertHex}` : null;

  // Connected without a current advert: ask main to export one. The node
  // cache broadcast that follows fills this card in.
  useEffect(() => {
    if (!client || !connected || advertHex) return;
    void api.getAdvertLink(client).catch(() => {
      // Shown below as "no advert link"; nothing to toast for a background fetch.
    });
  }, [client, connected, advertHex]);

  return (
    <NodeCard icon={KeyRound} title="Identity & sharing" className={className}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-[104px] shrink-0 items-center justify-center rounded-md bg-white p-1.5">
          {uri ? (
            <QRCode value={uri} size={92} aria-label="Contact QR code" role="img" />
          ) : (
            <span className="px-2 text-center text-[11px] leading-4 text-neutral-600">
              {connected ? 'Exporting advert…' : 'No advert link'}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="label-caps text-cs-text-muted">Public key</span>
            {publicKey ? (
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate font-mono text-[12px] text-cs-text" title={publicKey}>
                  {shortKey(publicKey)}
                </span>
                <CopyButton
                  value={publicKey}
                  title="Copy public key"
                  className="rounded p-1 text-cs-text-muted hover:bg-cs-bg-3 hover:text-cs-text focus-visible:outline-1 focus-visible:outline-cs-accent"
                >
                  <Copy aria-hidden="true" className="size-3" />
                  <span className="sr-only">Copy public key</span>
                </CopyButton>
              </span>
            ) : (
              <span className="font-mono text-[12px] text-cs-text-muted">—</span>
            )}
          </div>
          {uri ? (
            <CopyButton
              value={uri}
              title="Copy the meshcore:// contact link"
              className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'w-fit')}
            >
              <Share2 aria-hidden="true" />
              Copy advert link
            </CopyButton>
          ) : (
            !connected && <span className="text-[11px] text-cs-text-muted">Connect to refresh the advert link.</span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-cs-text-muted">Scan with the MeshCore app to add this radio as a contact.</p>
    </NodeCard>
  );
}
