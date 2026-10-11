import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiClient, api } from '../../lib/api';
import { isLibUnsupportedError, markLibUnsupported } from './libSupport';

// The radio's sensor settings (CMD_GET_CUSTOM_VARS), read fresh each time My
// radio opens or the radio reconnects. MeshCore reports at most `gps` (0/1),
// and only when it detected a GPS; `gps_interval` is write-only.

/** Keys the radio takes but never reports: written without showing them in `vars`. */
const WRITE_ONLY = new Set(['gps_interval']);

export type SensorSettings =
  | { status: 'offline' }
  | { status: 'loading' }
  | { status: 'unsupported' }
  | { status: 'error'; error: string }
  | { status: 'ok'; vars: Readonly<Record<string, string>> };

export interface SensorSettingsControl {
  settings: SensorSettings;
  /** Read them again (after a failed read). */
  reload: () => void;
  /**
   * Write one setting, showing it at once and restoring the old value if the
   * radio refuses. Resolves when settled; rejects with the server's error.
   */
  write: (key: string, value: string) => Promise<void>;
}

export function useSensorSettings(client: ApiClient | null, connected: boolean): SensorSettingsControl {
  const [settings, setSettings] = useState<SensorSettings>({ status: connected ? 'loading' : 'offline' });
  const [generation, setGeneration] = useState(0);
  // The newest value written per key, so an older write's rollback can't undo a newer one.
  const latest = useRef(new Map<string, string>());
  const current = useRef(settings);
  current.current = settings;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the reload trigger
  useEffect(() => {
    if (!client || !connected) {
      setSettings({ status: 'offline' });
      return;
    }
    let cancelled = false;
    setSettings({ status: 'loading' });
    api.getSensorSettings(client).then(
      (vars) => {
        if (!cancelled) setSettings({ status: 'ok', vars });
      },
      (err: unknown) => {
        if (cancelled) return;
        if (isLibUnsupportedError(err)) {
          markLibUnsupported();
          setSettings({ status: 'unsupported' });
        } else {
          setSettings({ status: 'error', error: (err as Error).message });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, connected, generation]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  const write = useCallback(
    async (key: string, value: string) => {
      if (!client) throw new Error('No server connection');
      // Merged into `vars` it would stay there as a setting the radio "reported".
      if (WRITE_ONLY.has(key)) {
        try {
          await api.putSensorSetting(client, key, value);
        } catch (err) {
          if (isLibUnsupportedError(err)) markLibUnsupported();
          throw err;
        }
        return;
      }
      const shown = current.current;
      const before = shown.status === 'ok' ? shown.vars[key] : undefined;
      setSettings((s) => (s.status === 'ok' ? { status: 'ok', vars: { ...s.vars, [key]: value } } : s));
      latest.current.set(key, value);
      try {
        await api.putSensorSetting(client, key, value);
      } catch (err) {
        if (isLibUnsupportedError(err)) markLibUnsupported();
        if (latest.current.get(key) === value) {
          setSettings((s) => {
            if (s.status !== 'ok') return s;
            const vars = { ...s.vars };
            if (before === undefined) delete vars[key];
            else vars[key] = before;
            return { status: 'ok', vars };
          });
        }
        throw err;
      }
    },
    [client],
  );

  return { settings, reload, write };
}
