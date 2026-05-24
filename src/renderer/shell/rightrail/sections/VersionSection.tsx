import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { KeyValueRow } from '../../../components/ui/KeyValueRow';
import { useStore } from '../../../lib/store';
import { Placeholder } from '../atoms';

const COPIED_TIMEOUT_MS = 1200;

export function VersionSection() {
  const capabilities = useStore((s) => s.capabilities);
  const [copied, setCopied] = useState(false);

  if (!capabilities) return <Placeholder label="loading…" />;

  const onCopySha = () => {
    void navigator.clipboard.writeText(capabilities.gitSha).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_TIMEOUT_MS);
    });
  };

  return (
    <div className="space-y-1.5 text-cs-text-muted">
      <KeyValueRow label="Version" value={capabilities.version} mono />
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-cs-text-dim">
          Commit
        </span>
        <button
          type="button"
          onClick={onCopySha}
          title={copied ? 'Copied' : 'Click to copy'}
          className="inline-flex items-center gap-1 truncate font-mono tabular-nums text-[11px] text-cs-text hover:text-cs-text-bright"
        >
          <span>{capabilities.gitSha}</span>
          {copied ? (
            <Check className="h-3 w-3 text-cs-text-dim" aria-hidden />
          ) : (
            <Copy className="h-3 w-3 text-cs-text-dim" aria-hidden />
          )}
        </button>
      </div>
      <KeyValueRow label="Electron" value={capabilities.electronVersion} mono />
      <KeyValueRow label="Platform" value={capabilities.platform} mono />
    </div>
  );
}
