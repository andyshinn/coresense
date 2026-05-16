import { getNameColor, initialsFor } from '../lib/contactColor';
import { cn } from '../lib/utils';

interface Props {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_PX: Record<NonNullable<Props['size']>, number> = { sm: 24, md: 32 };

export function ContactAvatar({ name, size = 'sm', className }: Props) {
  const { fg, bg } = getNameColor(name);
  const px = SIZE_PX[size];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium',
        className,
      )}
      style={{
        width: px,
        height: px,
        backgroundColor: bg,
        color: fg,
        fontSize: size === 'sm' ? 10 : 12,
      }}
    >
      {initialsFor(name)}
    </div>
  );
}
