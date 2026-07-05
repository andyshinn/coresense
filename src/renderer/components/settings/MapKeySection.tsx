import { Map as MapIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { Row, TextInput } from './Field';
import { SettingsSection } from './SettingsSection';

interface Props {
  client: ApiClient | null;
}

const MB = 1024 * 1024;
const CACHE_CAP_OPTIONS = [256, 512, 1024, 2048, 5120].map((mb) => ({
  value: String(mb * MB),
  label: mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`,
}));

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1)} GB`;
  return `${(bytes / MB).toFixed(1)} MB`;
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
  const settings = useStore((s) => s.mapSettings);
  const applyMapSettings = useStore((s) => s.applyMapSettings);
  const [cacheInfo, setCacheInfo] = useState<{ bytes: number; count: number } | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    api
      .getTileCacheInfo(client)
      .then((info) => {
        if (!cancelled) setCacheInfo(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function clearCache() {
    if (!client) return;
    setBusy(true);
    try {
      const info = await api.clearTileCache(client);
      setCacheInfo(info);
      notify.success('Tile cache cleared');
    } catch (err) {
      notify.error(`Failed to clear cache: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  }

  function openCacheFolder() {
    if (!client) return;
    void api
      .openTileCacheFolder(client)
      .catch((err) => notify.error(`Failed to open folder: ${(err as Error).message}`, err));
  }

  function setCacheCap(bytes: number) {
    const next = { ...settings, tileCacheMaxBytes: bytes };
    applyMapSettings(next);
    if (client) void api.putMapSettings(client, next);
  }

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
      <Row
        label="Cache size limit"
        description="Downloaded tiles are cached on disk up to this size; oldest tiles are evicted first."
        control={
          <select
            aria-label="Cache size limit"
            value={String(settings.tileCacheMaxBytes)}
            disabled={!client}
            onChange={(e) => setCacheCap(Number(e.target.value))}
            className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {CACHE_CAP_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        }
      />
      <Row
        label="Tile cache"
        description={cacheInfo ? `${formatBytes(cacheInfo.bytes)} · ${cacheInfo.count} tiles` : 'Loading…'}
        control={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCacheFolder}
              disabled={!client}
              className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open folder
            </button>
            <button
              type="button"
              onClick={clearCache}
              disabled={busy || !client}
              className="rounded border border-cs-border bg-cs-bg-2 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear cache
            </button>
          </div>
        }
      />
    </SettingsSection>
  );
}
