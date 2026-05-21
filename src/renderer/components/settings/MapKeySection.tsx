import { Map as MapIcon } from 'lucide-react';
import { useState } from 'react';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { Row, TextInput } from './Field';
import { SettingsSection } from './SettingsSection';

interface Props {
  client: ApiClient | null;
}

// Self-contained because the Protomaps API key is not part of AppSettings —
// it's an OS-encrypted secret managed by main. The renderer only ever sees
// `hasProtomapsApiKey: boolean` (broadcast via MapSettings); the plaintext
// flows one way (renderer → main on POST) and never back. Because the key is
// write-only it keeps its own inline Save/Remove buttons rather than the
// section-level dirty/Save model.
export function MapKeySection({ client }: Props) {
  const hasKey = useStore((s) => s.mapSettings.hasProtomapsApiKey);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!client || !draft.trim()) return;
    setBusy(true);
    try {
      await api.setProtomapsApiKey(client, draft.trim());
      setDraft('');
      notify.success('Protomaps API key saved');
    } catch (err) {
      notify.error(`Failed to save key: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!client) return;
    setBusy(true);
    try {
      await api.clearProtomapsApiKey(client);
      notify.success('Protomaps API key removed');
    } catch (err) {
      notify.error(`Failed to clear key: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      id="app-map"
      icon={MapIcon}
      title="Map Tiles"
      description="Optional Protomaps hosted-API key. When set, the Map panel can pull higher-zoom tiles beyond the bundled extract. Stored encrypted in your OS keychain; never written to disk in plaintext."
      dirty={false}
    >
      <Row
        label={hasKey ? 'Replace API key' : 'Protomaps API key'}
        description={
          hasKey
            ? 'A key is saved. Paste a new key here to replace it.'
            : 'Paste your key from https://maps.protomaps.com/keys'
        }
        control={
          <div className="flex items-center gap-2">
            <TextInput value={draft} onChange={setDraft} disabled={busy || !client} width="w-56" />
            <button
              type="button"
              onClick={save}
              disabled={busy || !client || !draft.trim()}
              className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save
            </button>
            {hasKey && (
              <button
                type="button"
                onClick={clear}
                disabled={busy || !client}
                className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        }
      />
    </SettingsSection>
  );
}
