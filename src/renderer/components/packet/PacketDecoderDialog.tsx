import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';
import { Binary } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { inspectBleFrame } from '../../lib/bleFrameLayouts';
import { normalizeToHex } from '../../lib/packetInput';
import { inspectPacket } from '../../lib/packetInspect';
import { useStore } from '../../lib/store';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { PacketBreakdown } from './PacketBreakdown';

function useKeyStore() {
  const channels = useStore((s) => s.channels);
  return useMemo(() => {
    const secrets = channels.map((c) => c.secretHex).filter((x): x is string => !!x);
    return secrets.length ? MeshCoreDecoder.createKeyStore({ channelSecrets: secrets }) : undefined;
  }, [channels]);
}

export function PacketDecoderDialog() {
  const open = useStore((s) => s.ui.decoderOpen);
  const setDecoderOpen = useStore((s) => s.setDecoderOpen);
  const keyStore = useKeyStore();
  const [raw, setRaw] = useState('');
  const [kind, setKind] = useState<'rf' | 'ble'>('rf');
  const [decoded, setDecoded] = useState<ReactNode>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const norm = normalizeToHex(raw);
  const nBytes = norm ? norm.hex.length / 2 : 0;

  const onDecode = () => {
    setError(null);
    if (!norm) {
      setError('Could not read that as hex, base64, or a meshcore:// link.');
      setDecoded(null);
      return;
    }
    if (kind === 'ble') {
      const b = inspectBleFrame(norm.hex);
      setDecoded(
        <PacketBreakdown
          title="BLE Frame Breakdown"
          count={b.bytes.length}
          bytes={b.bytes}
          fields={b.fields}
          scope="ble"
          hovered={hovered}
          setHovered={setHovered}
        />,
      );
      return;
    }
    const d = inspectPacket(norm.hex, keyStore ? { keyStore } : undefined);
    if (!d.ok && !d.fields.length) {
      setError(d.error ?? 'Decode failed.');
      setDecoded(null);
      return;
    }
    setDecoded(
      <>
        <PacketBreakdown
          title="Packet Byte Breakdown"
          count={d.size}
          bytes={d.bytes}
          fields={d.fields}
          scope="packet"
          hovered={hovered}
          setHovered={setHovered}
        />
        {d.payload && (
          <PacketBreakdown
            title={`${d.payload.typeName} Payload Byte Breakdown`}
            count={d.payload.bytes.length}
            bytes={d.payload.bytes}
            fields={d.payload.fields}
            scope="payload"
            hovered={hovered}
            setHovered={setHovered}
          />
        )}
      </>,
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && setDecoderOpen(false)}>
      <DialogContent className="flex max-h-[calc(100%-2rem)] w-[560px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[7px] border border-cs-border-strong bg-cs-bg-2 p-0 text-cs-text">
        <div className="flex items-center gap-2 border-b border-cs-border px-4 py-3">
          <Binary size={14} className="text-cs-accent" />
          <DialogTitle className="text-[14px] font-semibold">Decode a packet</DialogTitle>
          <DialogDescription className="sr-only">
            Paste raw hex, base64, or a meshcore link to break it down.
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-2.5 inline-flex gap-0.5 rounded-md border border-cs-border bg-cs-bg-3 p-0.5">
            {(['rf', 'ble'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded px-3 py-1 text-[11.5px] ${kind === k ? 'bg-cs-bg text-cs-text' : 'text-cs-text-muted'}`}
              >
                {k === 'rf' ? 'RF packet' : 'BLE frame'}
              </button>
            ))}
          </div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Paste hex, base64, or meshcore://…"
            className="min-h-24 w-full resize-y rounded-md border border-cs-border bg-cs-bg px-2.5 py-2 font-mono text-[12px] text-cs-text outline-none"
          />
          <div className="mt-2.5 flex items-center gap-2.5">
            <span className="font-mono text-[10.5px] text-cs-text-dim">
              {nBytes} bytes{norm ? ` · ${norm.kind}` : ''}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onDecode}
              disabled={nBytes < 1}
              className="rounded-md bg-cs-accent px-3.5 py-1.5 text-[12px] font-semibold text-cs-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Decode
            </button>
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-cs-danger/30 bg-cs-danger/10 px-3 py-2 text-[11.5px] text-cs-text-muted">
              {error}
            </div>
          )}
          {decoded}
        </div>
      </DialogContent>
    </Dialog>
  );
}
