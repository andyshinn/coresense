import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { useStore } from '../../lib/store';
import { EMOJI_SEED, topIds } from './frecency';

interface Props {
  onPick: (emoji: string) => void;
  count?: number;
}

/** Inline one-click quick-react emoji, auto-pinned by frecency. */
export function ReactionRow({ onPick, count = 5 }: Props) {
  const usage = useStore((s) => s.ui.emojiUsage);
  const emojis = topIds(usage, Date.now(), count, EMOJI_SEED);
  return (
    <div className="flex items-center gap-0.5">
      {emojis.map((e) => (
        <Tooltip key={e}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onPick(e)}
              aria-label={`Reply with ${e}`}
              className="flex h-6 w-6 items-center justify-center rounded-md text-[16px] leading-none hover:bg-cs-bg-2"
            >
              {e}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Reply with {e}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
