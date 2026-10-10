import { Binary } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { companionFrameName } from '../../../shared/companionFrames';
import { type BleFrameInspection, inspectBleFrame } from '../../lib/bleFrameLayouts';
import { normalizeToHex } from '../../lib/packetInput';
import { inspectPacket, type PacketInspection } from '../../lib/packetInspect';
import { useStore } from '../../lib/store';
import { useChannelKeyStore } from '../../lib/useChannelKeyStore';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import { BleFrameView } from './BleFrameView';
import { PacketInspectionView } from './PacketInspectionView';

/** `seq` keys the breakdown view, so every decode starts with a clear hover. */
type DecodeResult = { seq: number } & ({ kind: 'rf'; d: PacketInspection } | { kind: 'ble'; b: BleFrameInspection });

export function PacketDecoderDialog() {
  const open = useStore((s) => s.decoderOpen);
  const setDecoderOpen = useStore((s) => s.setDecoderOpen);
  const keyStore = useChannelKeyStore();
  const [raw, setRaw] = useState('');
  const [kind, setKind] = useState<'rf' | 'ble'>('rf');
  const [result, setResult] = useState<DecodeResult | null>(null);
  const decodeSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);

  // Only re-parse the textarea contents when they actually change, not on
  // every render triggered by hover/selection state elsewhere in the dialog.
  const norm = useMemo(() => normalizeToHex(raw), [raw]);
  const nBytes = norm ? norm.hex.length / 2 : 0;

  const onDecode = () => {
    setError(null);
    // Field keys (pk0, pl0, …) repeat across unrelated decodes, so a stale
    // hover from a previous result could otherwise "stick" and highlight the
    // wrong field in the new breakdown. A fresh seq remounts the view.
    const seq = ++decodeSeq.current;
    if (!norm) {
      setError('Could not read that as hex, base64, or a meshcore:// link.');
      setResult(null);
      return;
    }
    if (kind === 'ble') {
      // A pasted frame starts with its 1-byte type code. The companion layouts describe
      // the body after it, the same split main makes, so name the frame and strip it.
      const code = Number.parseInt(norm.hex.slice(0, 2), 16);
      setResult({ seq, kind: 'ble', b: inspectBleFrame(norm.hex.slice(2), companionFrameName(code)) });
      return;
    }
    const d = inspectPacket(norm.hex, keyStore ? { keyStore } : undefined);
    if (!d.ok && !d.fields.length) {
      setError(d.error ?? 'Decode failed.');
      setResult(null);
      return;
    }
    setResult({ seq, kind: 'rf', d });
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
            className="min-h-24 w-full resize-y rounded-md border border-cs-border bg-cs-bg px-2.5 py-2 font-mono text-[12px] text-cs-text outline-none focus:border-cs-accent"
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
          {result?.kind === 'ble' && <BleFrameView key={result.seq} frame={result.b} />}
          {result?.kind === 'rf' && <PacketInspectionView key={result.seq} inspection={result.d} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
