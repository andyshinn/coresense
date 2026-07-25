import type { ActivityWindowKey } from '../../../../../shared/types';
import { ToggleGroup, ToggleGroupItem } from '../../../../components/ui/toggle-group';

/** "24h" alone is not comprehensible read aloud, so each item carries a spelled-out
 *  label for assistive tech while the visible text stays compact. */
const OPTIONS: Array<{ value: ActivityWindowKey; label: string; aria: string }> = [
  { value: '24h', label: '24h', aria: 'Last 24 hours' },
  { value: '7d', label: '7d', aria: 'Last 7 days' },
  { value: '30d', label: '30d', aria: 'Last 30 days' },
];

/** Radix ToggleGroup gives arrow-key roving focus for free; the className overrides
 *  strip its shadcn defaults (h-8, rounded-none/first:rounded-l-md, bg-accent when
 *  on, flex-1 stretching) down to the compact segmented control the design calls for. */
export function WindowTabs({ value, onChange }: { value: ActivityWindowKey; onChange: (w: ActivityWindowKey) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      // Radix emits '' when the active item is clicked again; keep the window pinned.
      onValueChange={(v) => {
        if (v) onChange(v as ActivityWindowKey);
      }}
      aria-label="Activity window"
      className="mb-3 inline-flex w-fit gap-0.5 rounded-[7px] border border-cs-border bg-cs-bg-3 p-0.5"
    >
      {OPTIONS.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          aria-label={o.aria}
          // toggle-group.tsx bakes in `first:rounded-l-md last:rounded-r-md` on the
          // item. Neither tailwind-merge (different merge group than the unprefixed
          // `rounded-[5px]` below) nor source order (the modifier selector has one
          // more specificity component) will let our radius win over those, so the
          // corners need their own modifier-scoped overrides here.
          className="h-auto min-w-0 flex-none rounded-[5px] first:rounded-l-[5px] last:rounded-r-[5px] px-[9px] py-1 font-mono text-[10.5px] font-medium text-cs-text-muted hover:bg-transparent hover:text-cs-text data-[state=on]:bg-cs-bg data-[state=on]:text-cs-accent data-[state=on]:shadow-[0_1px_0_rgba(0,0,0,0.3)]"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
