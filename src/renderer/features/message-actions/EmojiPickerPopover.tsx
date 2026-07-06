import type { ReactNode } from 'react';
import { EmojiPicker, EmojiPickerContent, EmojiPickerFooter, EmojiPickerSearch } from '../../components/ui/emoji-picker';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  children: ReactNode; // the trigger button
}

// emojibase-data is served by the app's renderer host (Vite dev / Hono prod).
const EMOJIBASE_URL = new URL('emoji', window.location.origin).toString();

/** The "more emoji" picker popover (frimousse) — reports the chosen emoji. */
export function EmojiPickerPopover({ open, onOpenChange, onPick, children }: Props) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[258px] border-cs-border-strong bg-cs-bg-2 p-0">
        <EmojiPicker
          className="h-[300px]"
          emojibaseUrl={EMOJIBASE_URL}
          onEmojiSelect={({ emoji }: { emoji: string }) => {
            onPick(emoji);
            onOpenChange(false);
          }}
        >
          <EmojiPickerSearch placeholder="Search emoji…" />
          <EmojiPickerContent />
          <EmojiPickerFooter />
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  );
}
