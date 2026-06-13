import { ChevronDown, ChevronUp, Pencil, Plus, X, Zap } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { AppSettings as AppSettingsType } from '../../../../shared/types';
import { SettingsSection } from '../../../components/settings/SettingsSection';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../../components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
import { QUICK_ACTIONS_BY_ID, type QuickActionDef } from '../../../features/quick-actions/catalog';
import { MAX_QUICK_ACTIONS, type QuickActionId } from '../../../features/quick-actions/ids';
import { QuickActions } from '../../../features/quick-actions/QuickActions';
import { sanitizeQuickActionIds } from '../../../features/quick-actions/sanitize';
import { addSlot, availableToAdd, moveSlot, removeSlot, setSlot } from '../../../features/quick-actions/slots';
import { useStore } from '../../../lib/store';
import { saveApp } from '../app/shared';
import type { SectionProps } from '../radio/shared';
import { useSettingsSection } from '../useSectionDraft';

const eqQuickActions = (a: AppSettingsType, b: AppSettingsType) =>
  a.quickActions.length === b.quickActions.length && a.quickActions.every((id, i) => id === b.quickActions[i]);

/** Searchable picker popover (reuses the command-palette cmdk primitives). */
function ActionPicker({
  available,
  onPick,
  trigger,
}: {
  available: QuickActionDef[];
  onPick: (id: QuickActionId) => void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-0">
        <Command>
          <CommandInput placeholder="Search actions…" />
          <CommandList>
            <CommandEmpty>No actions left.</CommandEmpty>
            <CommandGroup>
              {available.map((d) => {
                const Icon = d.icon;
                return (
                  <CommandItem
                    key={d.id}
                    value={d.label}
                    onSelect={() => {
                      onPick(d.id);
                      setOpen(false);
                    }}
                  >
                    <Icon className="size-3.5 text-cs-text-muted" aria-hidden />
                    <span>{d.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function QuickActionsTab({ client }: SectionProps) {
  const saved = useStore((s) => s.appSettings);
  const owner = useStore((s) => s.owner);
  const { draft, setDraft, dirty, saving, save } = useSettingsSection({
    id: 'quickActions-actions',
    saved,
    eq: eqQuickActions,
    onSave: (d) => saveApp(client, { quickActions: d.quickActions }, 'Quick actions saved'),
  });

  const slots = sanitizeQuickActionIds(draft.quickActions);
  const setSlots = (next: QuickActionId[]) => setDraft((s) => ({ ...s, quickActions: next }));
  const available = availableToAdd(slots).map((id) => QUICK_ACTIONS_BY_ID[id]);

  return (
    <SettingsSection
      id="quickActions-actions"
      icon={Zap}
      title="Owner Card Quick Actions"
      description="Choose up to 4 actions for the owner card. The first is the large primary button."
      dirty={dirty}
      saving={saving}
      canSave={!!client}
      onSave={save}
    >
      <div className="flex flex-col gap-1.5">
        {slots.map((id, i) => {
          const def = QUICK_ACTIONS_BY_ID[id];
          const Icon = def.icon;
          const availableForSlot = availableToAdd(slots.filter((_, j) => j !== i)).map((sid) => QUICK_ACTIONS_BY_ID[sid]);
          return (
            <div key={id} className="flex items-center gap-2 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1.5">
              <Icon className="size-4 shrink-0 text-cs-text-muted" aria-hidden />
              <span className="flex-1 text-[12px] text-cs-text">{def.label}</span>
              {i === 0 && (
                <span className="rounded-sm bg-cs-accent-soft/30 px-1 font-mono text-[9px] uppercase tracking-wide text-cs-accent">
                  Primary
                </span>
              )}
              {def.kind === 'toggle' && (
                <span className="font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">Toggle</span>
              )}
              {def.kind === 'danger' && (
                <span className="font-mono text-[9px] uppercase tracking-wide text-cs-danger">Danger</span>
              )}
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => setSlots(moveSlot(slots, i, i - 1))}
                  className="rounded p-1 text-cs-text-dim hover:text-cs-text disabled:opacity-30"
                >
                  <ChevronUp className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === slots.length - 1}
                  onClick={() => setSlots(moveSlot(slots, i, i + 1))}
                  className="rounded p-1 text-cs-text-dim hover:text-cs-text disabled:opacity-30"
                >
                  <ChevronDown className="size-3.5" aria-hidden />
                </button>
                <ActionPicker
                  available={availableForSlot}
                  onPick={(picked) => setSlots(setSlot(slots, i, picked))}
                  trigger={
                    <button
                      type="button"
                      aria-label="Change action"
                      className="rounded p-1 text-cs-text-dim hover:text-cs-text"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                  }
                />
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => setSlots(removeSlot(slots, i))}
                  className="rounded p-1 text-cs-text-dim hover:text-cs-danger"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {slots.length < MAX_QUICK_ACTIONS && available.length > 0 && (
        <ActionPicker
          available={available}
          onPick={(picked) => setSlots(addSlot(slots, picked))}
          trigger={
            <button
              type="button"
              className="mt-1 flex items-center gap-1.5 rounded-md border border-dashed border-cs-border px-2 py-1.5 text-[12px] text-cs-text-muted hover:text-cs-text"
            >
              <Plus className="size-3.5" aria-hidden />
              Add action
            </button>
          }
        />
      )}

      <div className="mt-4">
        <span className="font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">Preview</span>
        <div className="mt-1.5 w-56 rounded-lg border border-cs-border bg-cs-bg-2 p-2">
          <div className="pointer-events-none">
            <QuickActions owner={owner} client={client} idsOverride={slots} />
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
