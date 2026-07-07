import { getNameColor } from '../lib/contactColor';
import { cn, deriveSenderName } from '../lib/utils';

interface Props {
  /** Already-resolved display name (wins over `sender`). */
  name?: string;
  /** Raw from_pk: undefined/null=self, 'name:<n>', 'unknown', or hex pubkey. */
  sender?: string;
  variant?: 'text' | 'pill';
  size?: 'sm' | 'md';
  selfLabel?: string;
  onClick?: () => void;
  className?: string;
}

export function ColoredUsername({
  name,
  sender,
  variant = 'text',
  size = 'md',
  selfLabel = 'You',
  onClick,
  className,
}: Props) {
  let display: string;
  let neutral = false;
  if (name !== undefined) {
    display = name;
  } else if (sender === undefined || sender === null) {
    display = selfLabel;
    neutral = true;
  } else {
    const derived = deriveSenderName(sender); // '' for self / 'unknown'
    if (derived === '') {
      display = 'Unknown';
      neutral = true;
    } else {
      display = derived;
    }
  }

  const color = neutral ? null : getNameColor(display);
  const sizeCls = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const base = cn('font-medium leading-tight', sizeCls, neutral && 'text-cs-text-dim', className);

  if (variant === 'pill') {
    return (
      <span
        className={cn('inline-flex items-center rounded px-1.5 py-0.5', base)}
        style={{ color: color?.fg, backgroundColor: color?.pillBg }}
      >
        {onClick ? (
          <button type="button" onClick={onClick} className="bg-transparent">
            {display}
          </button>
        ) : (
          display
        )}
      </span>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(base, 'bg-transparent text-left')} style={{ color: color?.fg }}>
        {display}
      </button>
    );
  }
  return (
    <span className={base} style={{ color: color?.fg }}>
      {display}
    </span>
  );
}
