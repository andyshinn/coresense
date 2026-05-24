import { Copy, FileText } from 'lucide-react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { CopyButton } from '../../../components/CopyButton';
import { Row, Select, Toggle } from '../../../components/settings/Field';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { useStore } from '../../../lib/store';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';
import { saveApp } from './shared';

const LEVEL_OPTIONS = [
  { value: 'silly', label: 'silly' },
  { value: 'trace', label: 'trace' },
  { value: 'debug', label: 'debug' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
  { value: 'fatal', label: 'fatal' },
] as const;

const BTN =
  'flex items-center gap-1 rounded border border-cs-border bg-cs-bg-2 px-2 py-1 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50';

const eq = (a: AppSettingsType['logging'], b: AppSettingsType['logging']) =>
  a.fileEnabled === b.fileEnabled && a.level === b.level;

export function LoggingSection({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings.logging);
  const capabilities = useStore((s) => s.capabilities);

  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'app-logs',
    saved,
    eq,
    onSave: (d) => saveApp(client, { logging: d }, 'Saved logging settings'),
  });

  return (
    <SettingsSection
      id="app-logs"
      icon={FileText}
      title="Logs"
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <Row
        label="Minimum level"
        description="Filter how verbose logs are. `debug` is useful while developing; `info` is fine for everyday use."
        changed={draft.level !== saved.level}
        control={
          <Select
            value={draft.level}
            options={LEVEL_OPTIONS}
            onChange={(v) =>
              setDraft((s) => ({ ...s, level: v as AppSettingsType['logging']['level'] }))
            }
          />
        }
      />
      <Row
        label="Write logs to file"
        description="When enabled, every log entry is also written to a daily-rotated file in your app data folder. Files older than 7 days are pruned automatically."
        changed={draft.fileEnabled !== saved.fileEnabled}
        control={
          <Toggle
            checked={draft.fileEnabled}
            onChange={(v) => setDraft((s) => ({ ...s, fileEnabled: v }))}
          />
        }
      />
      <div className="px-2 py-1">
        <button
          type="button"
          className={BTN}
          onClick={() => useStore.getState().setActiveKey('tool:logs')}
        >
          <FileText className="size-3.5" />
          Open Logs panel
        </button>
      </div>
      {draft.fileEnabled && (
        <div className="space-y-3 px-2 py-1">
          <div>
            <div className="mb-1 text-[12px] text-cs-text">Logs folder</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-cs-border bg-cs-bg px-2 py-1 font-mono text-[11px] text-cs-text">
                {capabilities?.logsFolder ?? 'Unavailable'}
              </code>
              <CopyButton value={capabilities?.logsFolder ?? ''} className={BTN}>
                <Copy className="size-3" />
                Copy
              </CopyButton>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[12px] text-cs-text">Today's log file</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-cs-border bg-cs-bg px-2 py-1 font-mono text-[11px] text-cs-text">
                {capabilities?.logsCurrentFile ?? 'Unavailable'}
              </code>
              <CopyButton value={capabilities?.logsCurrentFile ?? ''} className={BTN}>
                <Copy className="size-3" />
                Copy
              </CopyButton>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className={BTN} onClick={() => window.coresense?.revealLogs()}>
              Reveal Folder
            </button>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
