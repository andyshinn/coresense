import { FlaskConical } from 'lucide-react';
import type { PathHashSize, RadioSettings } from '../../../../shared/types';
import { Row, Select } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { useSettingsSection } from '../useSectionDraft';
import type { SectionProps } from './shared';

const eq = (a: RadioSettings, b: RadioSettings) => a.pathHashMode === b.pathHashMode;

const PATH_HASH_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1-byte (max 64 hops) — legacy' },
  { value: '2', label: '2-byte (max 32 hops) — recommended' },
  { value: '3', label: '3-byte (max ~21 hops)' },
];

export function ExperimentalSection({ client }: SectionProps) {
  const saved = useStore((s) => s.radioSettings);
  const connected = useStore((s) => s.transportState === 'connected');

  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'radio-experimental',
    saved,
    eq,
    onSave: async (d) => {
      if (!client) throw new Error('No server connection');
      // Merge our single field into the freshest store snapshot — the route
      // takes a full RadioSettings body, and we don't want a stale draft here
      // to undo a concurrent Radio-panel save.
      const latest = useStore.getState().radioSettings;
      await api.putRadioSettings(client, {
        ...latest,
        pathHashMode: d.pathHashMode,
        pushToDevice: connected,
      });
      notify.success(connected ? 'Experimental settings pushed to device' : 'Experimental settings saved app-side');
    },
  });

  return (
    <SettingsSection
      id="radio-experimental"
      icon={FlaskConical}
      title="Experimental"
      description="These settings are experimental and could cause issues. Only repeaters and companion devices in the path must be updated to use the multi-byte path hash feature."
      footnote="MeshCore firmware v1.14.0+ supports multi-byte path hashes. Older nodes only support 1-byte and will not receive messages if this is changed."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Path Hash Size"
        description="Bytes per hop in source-routed paths. Larger values reduce hash collisions per hop but lower the maximum path length."
        changed={draft.pathHashMode !== saved.pathHashMode}
        control={
          <Select<string>
            value={String(draft.pathHashMode)}
            options={PATH_HASH_OPTIONS}
            onChange={(v) => setDraft((d) => ({ ...d, pathHashMode: Number(v) as PathHashSize }))}
          />
        }
      />
    </SettingsSection>
  );
}
