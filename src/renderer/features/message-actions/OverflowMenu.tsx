import { KeyRound, Radio, Trash2, User, Waypoints } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Message } from '../../../shared/types';
import { copyToClipboard } from '../../components/ContextMenu';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { formatAllPathsHeard, formatFirstPathHeard } from './paths';

interface Props {
  message: Message;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function OverflowMenu({ message, open, onOpenChange, children }: Props) {
  const setActiveKey = useStore((s) => s.setActiveKey);
  const pk = message.fromPublicKeyHex;
  const hasRealPk = pk != null && pk !== 'unknown' && !pk.startsWith('name:');
  const firstPath = formatFirstPathHeard(message);
  const allPaths = formatAllPathsHeard(message);

  const close = () => onOpenChange(false);
  const copy = (text: string, label: string) => copyToClipboard(text, () => notify.success(label));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-[216px] border-cs-border-strong bg-cs-bg-2 p-1">
        {hasRealPk && (
          <MenuButton
            icon={<User size={15} />}
            label="View contact"
            onClick={() => {
              setActiveKey(`c:${pk}`);
              close();
            }}
          />
        )}
        {hasRealPk && (
          <MenuButton
            icon={<KeyRound size={15} />}
            label="Copy public key"
            onClick={() => {
              copy(pk, 'Copied public key');
              close();
            }}
          />
        )}
        {firstPath && (
          <MenuButton
            icon={<Waypoints size={15} />}
            label="Copy first path heard"
            onClick={() => {
              copy(firstPath, 'Copied first path');
              close();
            }}
          />
        )}
        {allPaths && (
          <MenuButton
            icon={<Radio size={15} />}
            label="Copy all paths heard"
            onClick={() => {
              copy(allPaths, 'Copied all paths');
              close();
            }}
          />
        )}
        <div className="my-1 h-px bg-cs-border" />
        <MenuButton icon={<Trash2 size={15} />} label="Dismiss locally" destructive soon />
      </PopoverContent>
    </Popover>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  destructive,
  soon,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  destructive?: boolean;
  soon?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={soon}
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
        soon ? 'cursor-default opacity-45' : 'hover:bg-cs-bg-3',
        destructive ? 'text-cs-danger hover:bg-cs-danger/10' : 'text-cs-text',
      ].join(' ')}
    >
      <span className={destructive ? 'text-cs-danger' : 'text-cs-text-muted'}>{icon}</span>
      <span className="flex-1">{label}</span>
      {soon && <span className="rounded border border-cs-border px-1 text-[9px] text-cs-text-dim">soon</span>}
    </button>
  );
}
