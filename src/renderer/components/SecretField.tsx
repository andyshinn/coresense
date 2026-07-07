import { Copy, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';
import { CopyButton } from './CopyButton';

/** A channel/API secret shown masked by default, with reveal + copy. Never
 *  renders the full hex until the user explicitly reveals it. */
export function SecretField({ secretHex }: { secretHex: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <code className={cn('font-mono text-[11px] text-cs-text', revealed ? 'break-all' : 'truncate')}>
        {revealed ? secretHex : '•'.repeat(12)}
      </code>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? 'Hide secret' : 'Reveal secret'}
        title={revealed ? 'Hide secret' : 'Reveal secret'}
        className="text-cs-text-dim hover:text-cs-text"
      >
        {revealed ? <EyeOff className="size-3" aria-hidden="true" /> : <Eye className="size-3" aria-hidden="true" />}
      </button>
      <CopyButton value={secretHex} title="Copy secret" className="text-cs-text-dim hover:text-cs-text">
        <Copy className="size-3" aria-hidden="true" />
      </CopyButton>
    </span>
  );
}
