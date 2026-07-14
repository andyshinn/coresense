import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from 'coresense';
import { Radio } from 'lucide-react';

// Rendered open so the portalled content is visible statically.
// cfg.overrides.Popover pins cardMode:single + a viewport sized for the panel.
export function NodeActions() {
  return (
    <div className="flex justify-center rounded-lg bg-cs-bg p-8 text-cs-text">
      <Popover open>
        <PopoverTrigger asChild>
          <Button variant="outline">
            <Radio /> Ridgeline Repeater
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Ridgeline Repeater</PopoverTitle>
            <PopoverDescription>Repeater · last heard 2m ago</PopoverDescription>
          </PopoverHeader>
          <div className="mt-3 flex flex-col gap-2">
            <Button size="sm" variant="secondary">
              Send message
            </Button>
            <Button size="sm" variant="ghost">
              Trace path
            </Button>
            <Button size="sm" variant="ghost">
              Remove contact
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
