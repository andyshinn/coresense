import { ScrollText } from 'lucide-react';
import { PACKET_LOG_BOUNDS } from '../../../shared/types';
import { NumberInput, Row } from '../../components/settings/Field';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { useStore } from '../../lib/store';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

// Live-update settings — no draft/Save flow. `setPacketLogSettings` writes
// straight into `ui.packetLog`, which App.tsx persists via the debounced
// `putUiState` effect, so `SettingsSection` is used without an `onSave`.
export function PacketLogSection() {
  const packetLog = useStore((s) => s.ui.packetLog);
  const setPacketLogSettings = useStore((s) => s.setPacketLogSettings);

  return (
    <SettingsSection
      id="extra-packetlog"
      icon={ScrollText}
      title="Packet Log"
      description="How many packets the Packet Log keeps in memory and on disk."
      dirty={false}
    >
      <Row
        label="Live buffer"
        description="Packets kept in memory and shown in the list."
        control={
          <NumberInput
            value={packetLog.liveBufferSize}
            min={PACKET_LOG_BOUNDS.liveBufferSize.min}
            max={PACKET_LOG_BOUNDS.liveBufferSize.max}
            step={100}
            onChange={(v) =>
              setPacketLogSettings({
                liveBufferSize: clamp(v, PACKET_LOG_BOUNDS.liveBufferSize.min, PACKET_LOG_BOUNDS.liveBufferSize.max),
              })
            }
          />
        }
      />
      <Row
        label="Stored history"
        description="Packets saved to disk so the log survives a reload. 0 turns off saving."
        control={
          <NumberInput
            value={packetLog.storedHistorySize}
            min={PACKET_LOG_BOUNDS.storedHistorySize.min}
            max={PACKET_LOG_BOUNDS.storedHistorySize.max}
            step={1000}
            onChange={(v) =>
              setPacketLogSettings({
                storedHistorySize: clamp(
                  v,
                  PACKET_LOG_BOUNDS.storedHistorySize.min,
                  PACKET_LOG_BOUNDS.storedHistorySize.max,
                ),
              })
            }
          />
        }
      />
    </SettingsSection>
  );
}
