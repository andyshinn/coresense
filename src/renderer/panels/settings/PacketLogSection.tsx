import { ScrollText } from 'lucide-react';
import { PACKET_LOG_BOUNDS, type UiState } from '../../../shared/types';
import { NumberInput, Row } from '../../components/settings/Field';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { useStore } from '../../lib/store';
import { useSettingsSection } from './useSectionDraft';

type PacketLogSettings = UiState['packetLog'];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

const eqPacketLog = (a: PacketLogSettings, b: PacketLogSettings) =>
  a.liveBufferSize === b.liveBufferSize && a.storedHistorySize === b.storedHistorySize;

// Draft + Save, like every other section — NOT live-update. A live input commits
// each keystroke, so typing 50000 first commits 5: the live buffer is trimmed in
// memory at once, and because ui-state writes are leading-edge coalesced
// (app/useUiStatePersistence.ts) main receives the 5 immediately and prunes the
// stored packets table down to it on the very next packet. Clamping happens only
// on save, so neither side ever sees a half-typed value.
export function PacketLogSection() {
  const saved = useStore((s) => s.ui.packetLog);
  const setPacketLogSettings = useStore((s) => s.setPacketLogSettings);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'extra-packetlog',
    saved,
    eq: eqPacketLog,
    onSave: async (d) => {
      const next = {
        liveBufferSize: clamp(d.liveBufferSize, PACKET_LOG_BOUNDS.liveBufferSize.min, PACKET_LOG_BOUNDS.liveBufferSize.max),
        storedHistorySize: clamp(
          d.storedHistorySize,
          PACKET_LOG_BOUNDS.storedHistorySize.min,
          PACKET_LOG_BOUNDS.storedHistorySize.max,
        ),
      };
      setPacketLogSettings(next);
      // Show what was actually applied. useSectionDraft only adopts a new saved
      // value while the draft is clean, and a clamped save leaves the draft
      // holding the out-of-range number — stuck "Unsaved" against a value it
      // never had. Runs on click, long after setDraft is initialised.
      setDraft(next);
    },
  });

  return (
    <SettingsSection
      id="extra-packetlog"
      icon={ScrollText}
      title="Packet Log"
      description="How many packets the Packet Log keeps in memory and on disk."
      dirty={dirty}
      saving={saving}
      onSave={save}
    >
      <Row
        label="Live buffer"
        description="Packets kept in memory and shown in the list."
        changed={draft.liveBufferSize !== saved.liveBufferSize}
        control={
          <NumberInput
            value={draft.liveBufferSize}
            min={PACKET_LOG_BOUNDS.liveBufferSize.min}
            max={PACKET_LOG_BOUNDS.liveBufferSize.max}
            step={100}
            onChange={(v) => setDraft((s) => ({ ...s, liveBufferSize: v }))}
          />
        }
      />
      <Row
        label="Stored history"
        description="Packets saved to disk so the log survives a reload. 0 turns off saving."
        changed={draft.storedHistorySize !== saved.storedHistorySize}
        control={
          <NumberInput
            value={draft.storedHistorySize}
            min={PACKET_LOG_BOUNDS.storedHistorySize.min}
            max={PACKET_LOG_BOUNDS.storedHistorySize.max}
            step={1000}
            onChange={(v) => setDraft((s) => ({ ...s, storedHistorySize: v }))}
          />
        }
      />
    </SettingsSection>
  );
}
