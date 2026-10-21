import { Radio } from 'lucide-react';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useStore } from '../../../lib/store';
import { fmtBandwidth, fmtFreqMhz } from '../../../shell/leftnav/ownerFormat';
import { CardLink, NodeCard } from '../NodeCard';

/** The radio's modulation, read-only: edits stay in Radio Settings. */
export function RadioCard({ className }: { className?: string }) {
  const radio = useStore((s) => s.radioSettings);
  const setActiveKey = useStore((s) => s.setActiveKey);
  return (
    <NodeCard
      icon={Radio}
      title="Radio"
      className={className}
      extras={
        <CardLink onClick={() => setActiveKey('tool:settings:radio')} label="Open Radio Settings">
          Radio Settings ›
        </CardLink>
      }
    >
      <div className="flex flex-col gap-1">
        <KeyValueRow
          label="Frequency"
          labelTone="muted"
          mono
          valueClassName="text-cs-accent"
          value={`${fmtFreqMhz(radio.frequencyHz)} MHz`}
        />
        <KeyValueRow label="Bandwidth" labelTone="muted" mono value={fmtBandwidth(radio.bandwidthHz)} />
        <KeyValueRow label="Spreading factor" labelTone="muted" mono value={`${radio.spreadingFactor}`} />
        <KeyValueRow label="Coding rate" labelTone="muted" mono value={`4/${radio.codingRate}`} />
        <KeyValueRow label="TX power" labelTone="muted" mono value={`${radio.txPowerDbm} dBm`} />
        <KeyValueRow label="Repeat" labelTone="muted" mono value={radio.repeatMode ? 'On' : 'Off'} />
      </div>
      <p className="text-[11px] text-cs-text-muted">Read-only here. Edit modulation and TX power in Radio Settings.</p>
    </NodeCard>
  );
}
