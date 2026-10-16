import { ArrowUpCircle, RefreshCw } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { api } from '../../../lib/api';
import { useApiClient } from '../../../lib/apiClientContext';
import { notify } from '../../../lib/notify';
import { useStore } from '../../../lib/store';
import { saveApp } from '../save';
import { useSettingsSection } from '../useSectionDraft';

const CHANNEL_OPTIONS = [
  { value: 'stable', label: 'Stable' },
  { value: 'development', label: 'Development' },
] as const;

const eqUpdates = (a: AppSettingsType, b: AppSettingsType) =>
  a.updates.channel === b.updates.channel && a.updates.autoCheck === b.updates.autoCheck;

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  checking: 'Checking…',
  'up-to-date': 'Up to date',
  available: 'Update available',
  downloading: 'Downloading…',
  downloaded: 'Downloaded — restart to apply',
  error: 'Check failed',
};

export function UpdatesSection() {
  const client = useApiClient();
  const saved = useStore((s) => s.appSettings);
  const updateState = useStore((s) => s.updateState);
  const { draft, setGroup, dirty, sectionProps } = useSettingsSection({
    id: 'app-updates',
    saved,
    eq: eqUpdates,
    onSave: (d) => saveApp(client, { updates: d.updates }, 'Update settings saved'),
  });

  const u = draft.updates;
  const s0 = saved.updates;

  const onCheck = () => {
    if (!client) return;
    void api.checkForUpdates(client).then(
      (r) => {
        if (r.updateState?.status === 'available') notify.success(`Update available: ${r.updateState.latestVersion}`);
        else if (r.updateState?.status === 'up-to-date') notify.info('You are up to date');
        else if (r.updateState?.status === 'error') notify.error(r.updateState.error ?? 'Update check failed');
      },
      (err) => notify.failure('Update check', err),
    );
  };

  const statusText = !updateState
    ? 'Idle'
    : updateState.status === 'error' && updateState.error
      ? updateState.error
      : (STATUS_LABEL[updateState.status] ?? updateState.status);
  const silentRestartHint =
    dirty && (s0.channel === 'stable' || u.channel === 'stable')
      ? 'Channel/auto-check changes to the silent updater apply on next launch.'
      : undefined;

  return (
    <SettingsSection
      {...sectionProps}
      icon={ArrowUpCircle}
      title="Updates"
      description="Choose an update channel and check for new versions."
      footnote={silentRestartHint}
      canSave={!!client}
    >
      <Row
        label="Update channel"
        description="Stable ships tested releases. Development tracks pre-release builds."
        changed={u.channel !== s0.channel}
        control={
          <Select value={u.channel} options={CHANNEL_OPTIONS} onChange={(channel) => setGroup('updates', { channel })} />
        }
      />
      <Row
        label="Automatically check for updates"
        description="Check in the background about once an hour."
        changed={u.autoCheck !== s0.autoCheck}
        control={<Toggle checked={u.autoCheck} onChange={(v) => setGroup('updates', { autoCheck: v })} />}
      />
      <Row
        label="Status"
        description={updateState?.currentVersion ? `Current version ${updateState.currentVersion}` : undefined}
        control={
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-cs-text-dim">{statusText}</span>
            <button
              type="button"
              disabled={!client}
              onClick={onCheck}
              className="flex items-center gap-1 rounded border border-cs-border bg-cs-bg-2 px-2 py-1 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className="size-3.5" />
              Check for Updates
            </button>
          </div>
        }
      />
    </SettingsSection>
  );
}
