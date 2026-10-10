import { Kbd } from '@/components/ui/kbd';

/** A run of `<Kbd>key</Kbd> label` hints. Renders only the items, so each
 *  caller keeps its own container layout; `itemClassName` styles every item. */
export function KbdHints({ items, itemClassName }: { items: [key: string, label: string][]; itemClassName?: string }) {
  return (
    <>
      {items.map(([key, label]) => (
        <span key={label} className={itemClassName}>
          <Kbd>{key}</Kbd> {label}
        </span>
      ))}
    </>
  );
}
