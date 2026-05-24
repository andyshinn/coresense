import { cn } from '../../lib/utils';

/** Italic dim placeholder used when a section has nothing to show. */
export function Placeholder({ label }: { label: string }) {
  return <p className={cn('italic text-cs-text-dim')}>{label}</p>;
}
