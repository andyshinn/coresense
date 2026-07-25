import type { ActivityWindow, ActivityWindowKey } from '../../../../../shared/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { type ActivityMode, axisTicks, bucketLabel, chartAriaLabel } from './activity';

const CELL = 'flex h-full flex-1 items-end rounded-t-[2px] hover:bg-cs-accent/9';
const BAR =
  'min-h-[2px] w-full rounded-t-[2px] bg-cs-accent transition-[height] duration-[180ms] ease-out motion-reduce:transition-none';

/** Plain flex-div bars — no charting library, per the design handoff. The plot is
 *  a single role="img" with a generated label; individual bars are decorative, so
 *  hover tooltips stay a pointer-only enhancement rather than 30 tab stops. */
export function VolumeChart({
  winKey,
  data,
  mode,
}: {
  winKey: ActivityWindowKey;
  data: ActivityWindow;
  mode: ActivityMode;
}) {
  const full = mode === 'full';
  // Guard the divisor so an all-zero window draws a flat baseline rather than NaN.
  const max = Math.max(1, ...data.buckets);
  const ticks = full ? axisTicks(winKey, data.startMs, data.buckets.length) : null;

  return (
    <div className="mt-3">
      <div
        role="img"
        aria-label={chartAriaLabel(winKey, data)}
        className="flex items-end gap-0.5"
        style={{ height: full ? 74 : 30 }}
      >
        {data.buckets.map((v, i) => {
          const style = { height: `${(v / max) * 100}%` };
          if (!full) {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional bar chart; the index is the identity
              <div key={i} className={CELL}>
                <div data-testid="activity-bar" className={BAR} style={style} />
              </div>
            );
          }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positional bar chart; the index is the identity
            <Tooltip key={i}>
              {/* asChild needs a real DOM child so Radix can attach its ref. */}
              <TooltipTrigger asChild>
                <div className={CELL}>
                  <div data-testid="activity-bar" className={BAR} style={style} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                {`${v} msg${v === 1 ? '' : 's'} · ${bucketLabel(winKey, data.startMs, i, data.buckets.length)}`}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {ticks && (
        <div data-testid="activity-axis" className="mt-1.5 flex gap-0.5">
          {ticks.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional axis, one tick per bar
            <span key={`${winKey}-tick-${i}`} className="flex-1 text-center font-mono text-[8.5px] text-cs-text-dim">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
