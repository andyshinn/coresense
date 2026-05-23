import { Copy, Eye, EyeOff, KeyRound } from 'lucide-react';
import { useState } from 'react';
import type { ApiClient } from '../../lib/api';
import { useStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { CopyButton } from '../CopyButton';
import { SettingsSection } from './SettingsSection';

interface Props {
  client: ApiClient | null;
}

const BTN =
  'flex items-center gap-1 rounded border border-cs-border bg-cs-bg-2 px-2 py-1 text-[12px] text-cs-text hover:bg-cs-bg-3 disabled:cursor-not-allowed disabled:opacity-50';

// Read-only section that surfaces the shared API key so it can be copied out of
// the desktop app — e.g. to paste into a browser's first-launch prompt — without
// hunting down config.json. Self-contained (no Save model): it just displays
// the key this client is already authenticated with, plus the config path.
export function ApiKeySection({ client }: Props) {
  const apiKey = client?.apiKey ?? null;
  const configPath = useStore((s) => s.capabilities?.configPath ?? null);
  const [revealed, setRevealed] = useState(false);

  return (
    <SettingsSection
      id="app-api-key"
      icon={KeyRound}
      title="API Access"
      description="This key authenticates every API and browser client. To open CoreSense in a web browser, copy the key and paste it into the browser's first-launch prompt. The key is shared across all clients and stored in the config file below."
      dirty={false}
    >
      <div className="space-y-3 px-2 py-1">
        <div>
          <div className="mb-1 text-[12px] text-cs-text">API key</div>
          <div className="flex items-center gap-2">
            <code
              className={cn(
                'min-w-0 flex-1 rounded border border-cs-border bg-cs-bg px-2 py-1 font-mono text-[11px] text-cs-text',
                revealed ? 'break-all' : 'truncate',
              )}
            >
              {apiKey ? (revealed ? apiKey : '•'.repeat(48)) : 'Unavailable'}
            </code>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              disabled={!apiKey}
              className={BTN}
              title={revealed ? 'Hide key' : 'Reveal key'}
            >
              {revealed ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <CopyButton
              value={apiKey ?? ''}
              className={cn(BTN, !apiKey && 'pointer-events-none opacity-50')}
            >
              <Copy className="size-3" />
              Copy
            </CopyButton>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[12px] text-cs-text">Config file</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-cs-border bg-cs-bg px-2 py-1 font-mono text-[11px] text-cs-text">
              {configPath ?? 'Unavailable'}
            </code>
            <CopyButton
              value={configPath ?? ''}
              className={cn(BTN, !configPath && 'pointer-events-none opacity-50')}
            >
              <Copy className="size-3" />
              Copy
            </CopyButton>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
