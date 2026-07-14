import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from 'coresense';
import { Hash, Plus, Radio, RefreshCw, Settings, UserPlus, Wifi } from 'lucide-react';

// cmdk renders inline (no portal); the palette needs a sized container.
function Frame({ children }) {
  return (
    <div className="h-80 w-80 overflow-hidden rounded-lg border border-cs-border bg-cs-bg-2 text-cs-text shadow-md">
      {children}
    </div>
  );
}

export function Palette() {
  return (
    <Frame>
      <Command>
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            <CommandItem>
              <Hash /> Go to channel
              <CommandShortcut>⌘1</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <Wifi /> Open map
              <CommandShortcut>⌘2</CommandShortcut>
            </CommandItem>
            <CommandItem>
              <Settings /> Settings
              <CommandShortcut>⌘,</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem>
              <Radio /> Connect node
            </CommandItem>
            <CommandItem>
              <Plus /> New channel
            </CommandItem>
            <CommandItem>
              <UserPlus /> Add contact
            </CommandItem>
            <CommandItem>
              <RefreshCw /> Rescan mesh
              <CommandShortcut>⌘R</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </Frame>
  );
}
