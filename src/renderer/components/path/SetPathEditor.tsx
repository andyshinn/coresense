import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, Plus, RotateCcw, Save, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Contact, PathHashSize } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import { ContactAvatar } from '../ContactAvatar';
import { PathHashBadge } from '../PathHashBadge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Separator } from '../ui/separator';
import { makeId, splitHopsHex } from './resolveRepeater';

interface Hop {
  id: string;
  prefixHex: string;
}

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

export function SetPathEditor({ contact, client }: Props) {
  const radioPathHashMode = useStore((s) => s.radioSettings.pathHashMode);
  const contacts = useStore((s) => s.contacts);

  const hashSize: PathHashSize = (contact.outPathHashSize ?? radioPathHashMode) as PathHashSize;

  const savedHex = contact.outPathHex ?? '';
  const initialHops = useMemo<Hop[]>(
    () => splitHopsHex(savedHex, hashSize).map((prefixHex) => ({ id: makeId(), prefixHex })),
    [savedHex, hashSize],
  );

  const [hops, setHops] = useState<Hop[]>(initialHops);
  const [preferDirect, setPreferDirect] = useState<boolean>(contact.preferDirect === true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSearch, setAddSearch] = useState('');

  // Resync local edit state whenever the saved path or the selected contact
  // changes. Without this, switching from repeater A → B in the same rail slot
  // would show A's hops because useState only seeds on mount; and a successful
  // round-trip wouldn't refresh the hop ids after the server upserts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keying on contact.key + savedHex covers all reseeds; including the derived initialHops array would loop.
  useEffect(() => {
    setHops(initialHops);
    setPreferDirect(contact.preferDirect === true);
  }, [contact.key, savedHex, contact.preferDirect]);

  // The repeaters known to the app — used for the Add-hop popover. Match on
  // either name or full pubkey hex; the prefix we send is the first
  // hashSize*2 chars of their pubkey.
  const repeaterChoices = useMemo(
    () =>
      contacts
        .filter((c) => c.kind === 'repeater' && c.publicKeyHex.length >= hashSize * 2)
        .map((c) => ({
          contactKey: c.key,
          name: c.name,
          prefixHex: c.publicKeyHex.slice(0, hashSize * 2),
        })),
    [contacts, hashSize],
  );

  // Reset hops if the saved path changed underneath us (e.g. auto-learned).
  // We only reset when not currently dirty; otherwise the user's edits win.
  const currentHex = hops.map((h) => h.prefixHex).join('');
  const dirty = currentHex !== savedHex || preferDirect !== (contact.preferDirect === true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setHops((prev) => {
      const from = prev.findIndex((h) => h.id === active.id);
      const to = prev.findIndex((h) => h.id === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const onRemoveHop = (id: string) => setHops((prev) => prev.filter((h) => h.id !== id));

  const onAddKnown = (prefixHex: string) => {
    setHops((prev) => [...prev, { id: makeId(), prefixHex }]);
    setAddOpen(false);
    setAddSearch('');
  };

  const onAddCustom = () => {
    const wanted = hashSize * 2;
    const cleaned = addSearch
      .toLowerCase()
      .replace(/[^0-9a-f]/g, '')
      .slice(0, wanted);
    if (cleaned.length !== wanted) {
      notify.error(`Custom hop must be exactly ${wanted} hex chars (${hashSize} bytes)`);
      return;
    }
    setHops((prev) => [...prev, { id: makeId(), prefixHex: cleaned }]);
    setAddOpen(false);
    setAddSearch('');
  };

  const onSave = async () => {
    if (!client) return;
    setBusy(true);
    try {
      await api.setContactPath(client, contact.key, {
        outPathHex: currentHex,
        preferDirect,
      });
      notify.success(currentHex ? `Path saved (${hops.length} hops)` : 'Path cleared');
    } catch (err) {
      notify.error(`Save failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!client) return;
    setBusy(true);
    try {
      await api.resetContactPath(client, contact.key);
      setHops([]);
      notify.success('Reset to flood');
    } catch (err) {
      notify.error(`Reset failed: ${(err as Error).message}`, err);
    } finally {
      setBusy(false);
    }
  };

  const pathSummary = preferDirect
    ? 'Direct'
    : hops.length === 0
      ? 'Flood'
      : `${hops.length} hop${hops.length === 1 ? '' : 's'}`;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-cs-text-muted">Path</span>
          <span className="font-mono text-[13px] text-cs-text">{pathSummary}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <PathHashBadge bytes={hashSize} />
          <span className="font-mono text-[11px] text-cs-text-dim">hops · radio default</span>
        </div>
      </div>

      <Separator />

      <div className="flex items-start gap-2">
        <Checkbox checked={preferDirect} onCheckedChange={(v) => setPreferDirect(v === true)} id="prefer-direct" />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="prefer-direct" className="cursor-pointer">
            Direct
          </Label>
          <span className="text-[11px] text-cs-text-dim">Connection to radio will prefer a direct path.</span>
        </div>
      </div>

      <Separator />

      <div className={preferDirect ? 'pointer-events-none opacity-40' : undefined}>
        <div className="mb-2 flex items-center justify-between">
          <Label className="text-[11px] uppercase tracking-wider text-cs-text-muted">Hops (in order)</Label>
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]">
                <Plus size={12} aria-hidden="true" />
                Add hop
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="end">
              <Command>
                <CommandInput
                  placeholder={`Search repeaters or enter ${hashSize * 2}-char prefix…`}
                  value={addSearch}
                  onValueChange={setAddSearch}
                />
                <CommandList>
                  <CommandEmpty>No matching repeaters</CommandEmpty>
                  <CommandGroup heading="Known repeaters">
                    {repeaterChoices.map((r) => (
                      <CommandItem
                        key={r.contactKey}
                        value={`${r.name} ${r.prefixHex}`}
                        onSelect={() => onAddKnown(r.prefixHex)}
                      >
                        <ContactAvatar name={r.name} size="sm" className="mr-2" />
                        <span className="flex-1 truncate">{r.name}</span>
                        <span className="font-mono text-[10px] text-cs-text-dim">{r.prefixHex}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {addSearch && (
                    <CommandGroup heading="Custom">
                      <CommandItem value={`custom:${addSearch}`} onSelect={onAddCustom}>
                        <Check size={12} className="mr-2" aria-hidden="true" />
                        <span className="flex-1">Use “{addSearch}”</span>
                        <span className="font-mono text-[10px] text-cs-text-dim">{hashSize * 2} chars</span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {hops.length === 0 ? (
          <div className="rounded border border-dashed border-cs-border bg-cs-bg-2 p-3 text-[12px] text-cs-text-dim">
            No hops — messages will flood to discover a path.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={hops.map((h) => h.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col gap-1">
                {hops.map((hop, i) => (
                  <HopRow
                    key={hop.id}
                    hop={hop}
                    index={i}
                    onRemove={() => onRemoveHop(hop.id)}
                    knownName={repeaterChoices.find((r) => r.prefixHex === hop.prefixHex)?.name ?? null}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <Separator />

      <div className="flex items-center gap-2">
        <Button type="button" onClick={onSave} disabled={!client || busy || !dirty} className="gap-1">
          <Save size={12} aria-hidden="true" />
          Save path
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={!client || busy || (!savedHex && hops.length === 0)}
          className="gap-1"
        >
          <RotateCcw size={12} aria-hidden="true" />
          Reset to flood
        </Button>
      </div>
    </div>
  );
}

interface HopRowProps {
  hop: Hop;
  index: number;
  knownName: string | null;
  onRemove: () => void;
}

function HopRow({ hop, index, knownName, onRemove }: HopRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: hop.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded border border-cs-border bg-cs-bg-2 px-2 py-1.5"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-cs-text-muted hover:text-cs-text active:cursor-grabbing"
        aria-label="Reorder hop"
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <span className="w-4 text-right font-mono text-[11px] text-cs-text-dim">{index + 1}</span>
      <ContactAvatar name={knownName ?? hop.prefixHex} size="sm" />
      <span className="flex-1 truncate text-[12px] text-cs-text">{knownName ?? '(unknown)'}</span>
      <Input value={hop.prefixHex} readOnly className="h-7 w-[100px] font-mono text-[11px]" aria-label="Hop prefix" />
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={onRemove} aria-label="Remove hop">
        <X size={12} aria-hidden="true" />
      </Button>
    </li>
  );
}
