import { Check } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { copyToClipboard } from './ContextMenu';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';

// How long the "Copied!" confirmation stays up after a successful copy.
const COPIED_VISIBLE_MS = 1400;

interface CopyButtonProps {
  /** Text written to the clipboard when the button is clicked. */
  value: string;
  /** Button content — label, icon, or both. */
  children: ReactNode;
  /** Confirmation text shown in the popover. Defaults to "Copied!". */
  copiedLabel?: string;
  /** Native tooltip for the button. */
  title?: string;
  /** Class names applied to the button element. */
  className?: string;
}

/** A copy affordance that confirms with a small "Copied!" popover anchored to
 *  the button itself, rather than a toast. Use for any inline copyable value.
 *  The popover is purely controlled (PopoverAnchor, not PopoverTrigger) so the
 *  click only copies — it never toggles the confirmation off. */
export function CopyButton({ value, children, copiedLabel = 'Copied!', title, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onClick = useCallback(() => {
    copyToClipboard(value, () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_VISIBLE_MS);
    });
  }, [value]);

  return (
    <Popover open={copied} onOpenChange={(open) => !open && setCopied(false)}>
      <PopoverAnchor asChild>
        <button type="button" onClick={onClick} title={title} className={className}>
          {children}
        </button>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="flex w-auto items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-cs-text"
      >
        <Check aria-hidden="true" className="size-3 text-cs-online" />
        {copiedLabel}
      </PopoverContent>
    </Popover>
  );
}
