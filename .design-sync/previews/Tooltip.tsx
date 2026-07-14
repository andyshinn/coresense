import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from 'coresense';
import { RefreshCw } from 'lucide-react';

// Rendered open so the portalled tooltip is visible statically.
// cfg.overrides.Tooltip pins cardMode:single + a small viewport.
export function OnButton() {
  return (
    <TooltipProvider>
      <div className="flex items-center justify-center rounded-lg bg-cs-bg p-10 text-cs-text">
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button size="icon" variant="outline" aria-label="Rescan mesh">
              <RefreshCw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Rescan mesh (⌘R)</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
