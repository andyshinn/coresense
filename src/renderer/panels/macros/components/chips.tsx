import { Globe, Hash, Reply, User } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MacroScope } from '../../../../shared/macros/types';
import { MACRO_CATALOG } from '../lib/catalog';
import { deriveMacroMode } from '../lib/macroMode';
import { TOKEN_COLORS } from '../lib/tokenColors';
import { keyedRuns, tokenize } from '../lib/tokenize';

/** A one-line, syntax-coloured rendering of a macro template. */
export function Snippet({ template, className }: { template: string; className?: string }) {
  const runs = useMemo(() => keyedRuns(tokenize(template, 'reply', MACRO_CATALOG).runs), [template]);
  return (
    <span className={cn('font-mono', className)}>
      {runs.map((run) => (
        <span key={run.key} style={{ color: TOKEN_COLORS[run.type] }}>
          {run.text}
        </span>
      ))}
    </span>
  );
}

const SCOPE_ICON: Record<MacroScope, typeof Globe> = { global: Globe, channel: Hash, contact: User };
const SCOPE_COLOR: Record<MacroScope, string> = {
  global: 'text-cs-text-dim',
  channel: 'text-cs-accent',
  contact: 'text-cs-online',
};

/** Scope marker — globe (global) / hash (channel) / user (contact) + label. */
export function ScopeTag({ scope, label }: { scope: MacroScope; label: string }) {
  const Icon = SCOPE_ICON[scope];
  return (
    <span className="inline-flex max-w-full items-center gap-1 text-[11px] text-cs-text-muted">
      <Icon className={cn('size-3 shrink-0', SCOPE_COLOR[scope])} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Reply / both indicator, derived from the variables a template references. */
export function ModeChip({ template }: { template: string }) {
  const mode = useMemo(() => deriveMacroMode(template, MACRO_CATALOG), [template]);
  if (mode === 'reply') {
    return (
      <Badge variant="outline" className="gap-1 border-cs-accent/40 px-1.5 py-0 text-[10px] text-cs-accent">
        <Reply className="size-2.5" aria-hidden="true" />
        reply
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px] text-cs-text-muted">
      both
    </Badge>
  );
}
