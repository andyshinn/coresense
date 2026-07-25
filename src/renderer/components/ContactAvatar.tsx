import { getNameColor, initialsFor } from '../lib/contactColor';
import { cn } from '../lib/utils';

interface Props {
  name: string;
  /** Explicit hash input, overriding the hash input derived from `name`. Pass
   *  the resolved pubkey to keep the avatar in step with the rail dot; pass
   *  null to force a neutral disc (an identity we cannot verify). Omit to hash
   *  the name. */
  identity?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_PX: Record<NonNullable<Props['size']>, number> = { sm: 24, md: 32 };

export function ContactAvatar({ name, identity, size = 'sm', className }: Props) {
  const hashInput = identity === undefined ? name : identity;
  const color = hashInput === null ? null : getNameColor(hashInput);
  const px = SIZE_PX[size];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium',
        color === null && 'bg-cs-bg-3 text-cs-text-dim',
        className,
      )}
      style={{
        width: px,
        height: px,
        backgroundColor: color?.bg,
        color: color?.fg,
        fontSize: size === 'sm' ? 10 : 12,
      }}
    >
      {initialsFor(name)}
    </div>
  );
}
