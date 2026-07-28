import { useIdentityHash } from '../hooks/useIdentityHash';
import { getNameColor } from '../lib/contactColor';
import { cn, deriveSenderName } from '../lib/utils';

interface Props {
  /** Already-resolved display name (wins over `sender`). */
  name?: string;
  /** Raw from_pk: undefined/null=self, 'name:<n>', 'unknown', or hex pubkey. */
  sender?: string;
  /** Explicit hash input, overriding this component's own sender-based
   *  resolution. Pass an identity a caller already resolved (e.g. MessageItem,
   *  sharing one resolution with ContactAvatar so the two agree) to keep them
   *  in step; pass null to force neutral (an identity we cannot verify). Omit
   *  to resolve from `sender` via the hook, as before. */
  identity?: string | null;
  variant?: 'text' | 'pill';
  size?: 'sm' | 'md';
  selfLabel?: string;
  onClick?: () => void;
  className?: string;
}

export function ColoredUsername({
  name,
  sender,
  identity,
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

  // Under 'byKey' this is the resolved pubkey (null when we've never heard an
  // advert); under 'byName' it's the display name. Self and 'unknown' stay
  // neutral in both modes — they have no identity to colour. `identity`, when
  // passed, overrides this hook-resolved value entirely (see the Props doc).
  const resolvedHash = useIdentityHash(neutral ? null : sender, display);
  const hashInput = identity !== undefined ? identity : resolvedHash;
  const color = neutral || hashInput === null ? null : getNameColor(hashInput);
  const sizeCls = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const base = cn('font-medium leading-tight', sizeCls, (neutral || !color) && 'text-cs-text-dim', className);

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
