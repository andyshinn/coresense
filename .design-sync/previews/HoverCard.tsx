import { HoverCard, HoverCardContent, HoverCardTrigger } from 'coresense';

// Rendered open so the portalled content is visible statically.
// cfg.overrides.HoverCard pins cardMode:single + a viewport for the panel.
export function NodeInfo() {
  return (
    <div className="flex justify-center rounded-lg bg-cs-bg p-8 text-cs-text">
      <HoverCard open>
        <HoverCardTrigger asChild>
          <a className="cursor-pointer font-medium text-cs-accent underline-offset-4 hover:underline">
            @ridgeline
          </a>
        </HoverCardTrigger>
        <HoverCardContent>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-cs-text">Ridgeline Repeater</div>
            <div className="text-xs text-cs-text-muted">
              High-altitude repeater on the north ridge. Relays traffic between the valley nodes.
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-cs-text-dim">
              <span className="font-mono">a3f9c1d8…2b7e</span>
              <span>3 hops</span>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}
