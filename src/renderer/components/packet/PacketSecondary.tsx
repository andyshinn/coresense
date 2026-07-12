import { Unlock } from 'lucide-react';
import type { Secondary } from '../../lib/packetInspect';
import { PacketBreakdown } from './PacketBreakdown';

interface Props {
  secondary: Secondary | null;
  hovered: string | null;
  setHovered: (id: string | null) => void;
}

/** Renders a payload's "secondary" view (decrypted plaintext / advert app-data /
 *  the locked note) below the payload byte breakdown. Shared by PacketDetailsRail
 *  and PacketDecoderDialog so both surfaces stay in sync. */
export function PacketSecondary({ secondary, hovered, setHovered }: Props) {
  if (!secondary) return null;

  if (secondary.kind === 'decrypted') {
    return (
      <>
        <div className="mt-5 flex items-center gap-2">
          <span className="text-[13.5px] font-bold text-cs-text">Decrypted Plaintext</span>
          <span className="inline-flex items-center gap-1 rounded border border-cs-online/35 bg-cs-online/10 px-1.5 py-0.5 font-mono text-[9.5px] text-cs-online">
            <Unlock size={11} /> key held
          </span>
        </div>
        <div className="mt-2.5">
          <PacketBreakdown
            title=""
            bytes={secondary.bytes}
            fields={secondary.fields}
            scope="plain"
            hovered={hovered}
            setHovered={setHovered}
          />
        </div>
      </>
    );
  }

  if (secondary.kind === 'appdata') {
    return (
      <PacketBreakdown
        title={secondary.title}
        count={secondary.bytes.length}
        bytes={secondary.bytes}
        fields={secondary.fields}
        scope="appdata"
        hovered={hovered}
        setHovered={setHovered}
      />
    );
  }

  return (
    <div className="mt-3 rounded-md border border-cs-accent/25 bg-cs-accent/10 px-3 py-2.5 text-[11.5px] text-cs-text-muted">
      {secondary.note}
    </div>
  );
}
