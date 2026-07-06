import { AlertTriangle, Check, Eye } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { DistanceUnit, ValidateResult } from '../../../../shared/macros/types';
import { type BudgetStatus, budgetStatus, MSG_LIMIT, previewEngine, renderPreview } from '../lib/preview';
import { replyContext, sendContext, worstCaseContext } from '../lib/sampleContext';
import type { PreviewMode } from './useStudio';

const STATUS_BAR: Record<BudgetStatus, string> = {
  ok: 'bg-cs-online',
  warn: 'bg-cs-warn',
  over: 'bg-cs-danger',
};

interface PreviewPaneProps {
  value: string;
  mode: PreviewMode;
  onModeChange: (m: PreviewMode) => void;
  distanceUnit: DistanceUnit;
  validation: ValidateResult;
}

export function PreviewPane({ value, mode, onModeChange, distanceUnit, validation }: PreviewPaneProps) {
  const engine = useMemo(() => previewEngine(distanceUnit), [distanceUnit]);
  const ctx = mode === 'reply' ? replyContext() : sendContext();
  const result = useMemo(() => renderPreview(engine, value, ctx), [engine, value, ctx]);
  const worst = useMemo(() => renderPreview(engine, value, worstCaseContext()), [engine, value]);

  const length = result.length;
  const status = length == null ? null : budgetStatus(length);
  const pct = length == null ? 0 : Math.min(100, (length / MSG_LIMIT) * 100);
  const worstPct = worst.length == null ? null : Math.min(100, (worst.length / MSG_LIMIT) * 100);

  return (
    <div className="flex h-full min-h-0 flex-col bg-cs-bg-2">
      <div className="flex shrink-0 items-center gap-2 border-b border-cs-border px-3 py-2">
        <Eye className="size-4 text-cs-accent" aria-hidden="true" />
        <span className="text-[12px] font-semibold text-cs-text">Preview</span>
        <div className="ml-auto inline-flex rounded-md border border-cs-border bg-cs-bg p-0.5" role="tablist">
          {[
            { m: 'reply' as PreviewMode, label: 'Reply' },
            { m: 'send' as PreviewMode, label: 'New send' },
          ].map(({ m, label }) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              data-testid={`preview-mode-${m}`}
              onClick={() => onModeChange(m)}
              className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                mode === m ? 'bg-cs-bg-3 text-cs-text' : 'text-cs-text-muted hover:text-cs-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="mb-2 text-[10px] text-cs-text-dim">
          {mode === 'reply'
            ? 'Replying to Alice · -95dBm / 5.5 snr · 2 hops'
            : 'New message to Alice · always-available variables only'}
        </p>

        <div
          data-testid="preview-output"
          className="min-h-[44px] whitespace-pre-wrap break-words rounded-xl border border-cs-border bg-cs-bg-3 px-3 py-2 text-[13px] text-cs-text"
        >
          {result.error ? (
            <span className="inline-flex items-center gap-1 text-cs-danger">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {result.error}
            </span>
          ) : result.text === '' ? (
            <span className="text-cs-text-dim">Nothing to preview yet.</span>
          ) : (
            result.text
          )}
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[13px] text-cs-text" data-testid="char-count">
              {length ?? '—'}
            </span>
            <span className="font-mono text-[10px] text-cs-text-dim">/ {MSG_LIMIT} chars</span>
          </div>
          <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-cs-bg">
            {status && (
              <div className={cn('h-full rounded-full transition-all', STATUS_BAR[status])} style={{ width: `${pct}%` }} />
            )}
            {worstPct != null && worstPct > pct && (
              <div
                className="absolute top-0 h-full w-px bg-cs-border-strong"
                style={{ left: `${worstPct}%` }}
                title="worst case"
              />
            )}
          </div>
          {length != null && status === 'over' && (
            <p className="mt-1 text-[10px] text-cs-danger">
              {length - MSG_LIMIT} over the {MSG_LIMIT}-char limit — this won’t send.
            </p>
          )}
          {length != null && status !== 'over' && worst.length != null && worst.length > MSG_LIMIT && (
            <p className="mt-1 text-[10px] text-cs-warn">Worst case could reach {worst.length} chars.</p>
          )}
        </div>

        <div className="mt-3">
          {validation.ok ? (
            <div className="inline-flex items-center gap-1 text-[11px] text-cs-online">
              <Check className="size-3.5" aria-hidden="true" />
              Valid
            </div>
          ) : (
            <div className="space-y-1">
              {validation.errors.map((e) => (
                <div key={`${e.kind}-${e.message}`} className="flex items-start gap-1 text-[11px] text-cs-danger">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
