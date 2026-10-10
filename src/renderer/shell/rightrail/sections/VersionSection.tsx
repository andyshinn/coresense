import { Copy } from 'lucide-react';
import { CopyButton } from '../../../components/CopyButton';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useStore } from '../../../lib/store';
import { Placeholder } from '../atoms';

export function VersionSection() {
  const capabilities = useStore((s) => s.capabilities);

  if (!capabilities) return <Placeholder label="loading…" />;

  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <KeyValueRow label="Version" value={capabilities.version} mono />
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-cs-text-dim">Commit</span>
        <CopyButton
          value={capabilities.gitSha}
          title="Click to copy"
          className="inline-flex items-center gap-1 truncate font-mono tabular-nums text-[11px] text-cs-text hover:text-cs-text-bright"
        >
          <span>{capabilities.gitSha}</span>
          <Copy className="h-3 w-3 text-cs-text-dim" aria-hidden />
        </CopyButton>
      </div>
      <KeyValueRow label="Electron" value={capabilities.electronVersion} mono />
      <KeyValueRow label="Platform" value={capabilities.platform} mono />
    </div>
  );
}
