import { ChevronRight, SlidersHorizontal } from 'lucide-react';
import { NODE_TELEMETRY_KEY } from '../../../../shared/keys';
import type { TelemetryPolicy } from '../../../../shared/types';
import { Row } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';

// Who can read this radio's telemetry is set in My Node's telemetry view, where the
// modes write straight to the radio next to the readings they govern. The
// section stays (its id is the `tool:settings:telemetry` deep link's target)
// as a summary and a link there. Multi-acks, which shares the radio frame,
// stays in Messages.

const MODE_LABEL: Record<TelemetryPolicy['base'], string> = { 0: 'Deny', 1: 'Per contact', 2: 'Everyone' };

/** "Base Everyone · Location Per contact · Environment Deny" */
export function policySummary(p: Pick<TelemetryPolicy, 'base' | 'loc' | 'env'>): string {
  return `Base ${MODE_LABEL[p.base]} · Location ${MODE_LABEL[p.loc]} · Environment ${MODE_LABEL[p.env]}`;
}

export function TelemetrySection() {
  const base = useStore((s) => s.telemetryPolicy.base);
  const loc = useStore((s) => s.telemetryPolicy.loc);
  const env = useStore((s) => s.telemetryPolicy.env);
  const setActiveKey = useStore((s) => s.setActiveKey);

  return (
    <SettingsSection
      id="radio-telemetry"
      icon={SlidersHorizontal}
      title="Telemetry"
      description="Who can query telemetry from this radio, and its sensor settings, are set in My node's telemetry view."
      dirty={false}
    >
      <Row
        label="Who can read my telemetry"
        description={policySummary({ base, loc, env })}
        control={
          <button
            type="button"
            onClick={() => setActiveKey(NODE_TELEMETRY_KEY)}
            className="flex items-center gap-1 rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:border-cs-accent hover:text-cs-accent"
          >
            Open telemetry sharing
            <ChevronRight className="size-3" aria-hidden />
          </button>
        }
      />
    </SettingsSection>
  );
}
