import type { LucideIcon } from 'lucide-react';
import { Construction } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export function PlaceholderPanel({ title, description, icon }: Props) {
  const Icon = icon ?? Construction;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="rounded-full border border-cs-border bg-cs-bg-2 p-3 text-cs-text-dim">
        <Icon size={20} aria-hidden="true" />
      </div>
      <h2 className="font-mono text-[11px] uppercase tracking-wider text-cs-text-muted">{title}</h2>
      {description && <p className="max-w-md text-sm text-cs-text-dim leading-relaxed">{description}</p>}
    </div>
  );
}
