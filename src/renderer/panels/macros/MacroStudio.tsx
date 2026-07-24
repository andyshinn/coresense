import { ArrowLeft, Check, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { type ApiClient, api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  buildSampleContext,
  lintTemplate,
  MACRO_VARIABLES,
  resolvePath,
  structureOf,
  validateTemplate,
} from '../../../shared/macros';
import type { MacroScope, MacroTemplate } from '../../../shared/macros/types';
import { ModeChip } from './components/chips';
import { MacroEditor } from './studio/MacroEditor';
import { PreviewPane } from './studio/PreviewPane';
import { useStudio } from './studio/useStudio';
import { VariableHoverCard } from './studio/VariableHoverCard';

const QUICK_VARS = ['sender_name', 'rssi', 'snr', 'my_pos', 'peer_name'];
const SCOPES: { value: MacroScope; label: string }[] = [
  { value: 'global', label: 'Global' },
  { value: 'channel', label: 'Channel' },
  { value: 'contact', label: 'Contact' },
];

interface MacroStudioProps {
  client: ApiClient | null;
  macro: MacroTemplate | null;
  onClose: () => void;
}

export function MacroStudio({ client, macro, onClose }: MacroStudioProps) {
  const st = useStudio(macro);
  const channels = useStore((s) => s.channels);
  const contacts = useStore((s) => s.contacts);
  const distanceUnit = useStore((s) => s.appSettings.distanceUnit);
  const setMacroStudioBridge = useStore((s) => s.setMacroStudioBridge);
  const [saving, setSaving] = useState(false);

  // Publish a handle so the Reference panel (rendered in the right rail) can
  // insert into this editor. Insert callbacks are stable, so this only re-runs
  // when the preview mode changes; cleared on unmount.
  useEffect(() => {
    setMacroStudioBridge({ previewMode: st.previewMode, insertVar: st.insertVar, insertText: st.insertText });
    return () => setMacroStudioBridge(null);
  }, [st.previewMode, st.insertVar, st.insertText, setMacroStudioBridge]);

  const validation = useMemo(() => validateTemplate(st.value), [st.value]);
  // Non-blocking: warnings never gate canSave, unlike `validation`.
  const warnings = useMemo(() => lintTemplate(st.value), [st.value]);
  const structureRoot = useMemo(() => structureOf(buildSampleContext()), []);
  const canSave = !!client && !saving && st.name.trim() !== '' && st.value.trim() !== '' && validation.ok;

  const save = async () => {
    if (!client || !canSave) return;
    setSaving(true);
    try {
      const base = {
        name: st.name.trim(),
        template: st.value,
        scope: st.scope,
        ...(st.scope === 'channel' ? { channelKey: st.channelKey } : {}),
        ...(st.scope === 'contact' ? { contactKey: st.contactKey } : {}),
      };
      if (macro) await api.updateMacro(client, macro.id, base);
      else await api.addMacro(client, base);
      notify.success(macro ? 'Macro saved' : 'Macro created');
      onClose();
    } catch (err) {
      notify.error(`Couldn’t save macro: ${(err as Error).message}`, err);
    } finally {
      setSaving(false);
    }
  };

  const onScopeChange = (next: MacroScope) => {
    st.setScope(next);
    if (next === 'channel' && !st.channelKey) st.setChannelKey(channels[0]?.key);
    if (next === 'contact' && !st.contactKey) st.setContactKey(contacts[0]?.key);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b border-cs-border bg-cs-bg-2 px-3 py-2">
        <button
          type="button"
          aria-label="Back to library"
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded text-cs-text-muted hover:bg-cs-bg-3 hover:text-cs-text"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-cs-text">{macro ? 'Edit macro' : 'New macro'}</div>
          <div className="font-mono text-[10px] text-cs-text-dim">Macros / {st.name.trim() || 'untitled'}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ModeChip template={st.value} />
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave}>
            <Check className="size-3.5" aria-hidden="true" />
            {macro ? 'Save macro' : 'Create macro'}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Editor column */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">Name</span>
              <input
                data-testid="macro-name"
                value={st.name}
                onChange={(e) => st.setName(e.target.value)}
                placeholder="Signal report"
                className="h-8 w-full rounded-md border border-cs-border bg-cs-bg-2 px-2 text-[13px] text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
              />
            </label>
            <div>
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">Scope</span>
              <div className="inline-flex rounded-md border border-cs-border bg-cs-bg-2 p-0.5">
                {SCOPES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={st.scope === s.value}
                    onClick={() => onScopeChange(s.value)}
                    className={cn(
                      'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                      st.scope === s.value ? 'bg-cs-bg-3 text-cs-text' : 'text-cs-text-muted hover:text-cs-text',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {st.scope === 'channel' && (
            <select
              aria-label="Channel"
              value={st.channelKey ?? ''}
              onChange={(e) => st.setChannelKey(e.target.value || undefined)}
              className="h-8 rounded-md border border-cs-border bg-cs-bg-2 px-2 text-[12px] text-cs-text outline-none focus:border-cs-accent"
            >
              <option value="">Select a channel…</option>
              {channels.map((c) => (
                <option key={c.key} value={c.key}>
                  #{c.name.replace(/^#/, '')}
                </option>
              ))}
            </select>
          )}
          {st.scope === 'contact' && (
            <select
              aria-label="Contact"
              value={st.contactKey ?? ''}
              onChange={(e) => st.setContactKey(e.target.value || undefined)}
              className="h-8 rounded-md border border-cs-border bg-cs-bg-2 px-2 text-[12px] text-cs-text outline-none focus:border-cs-accent"
            >
              <option value="">Select a contact…</option>
              {contacts.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">Template</span>
            <span className="font-mono text-[10px] text-cs-text-dim">
              <a
                href="https://liquidjs.com/"
                target="_blank"
                rel="noreferrer noopener"
                title="LiquidJS template docs"
                className="inline-flex items-center gap-0.5 text-cs-text-muted hover:text-cs-accent"
              >
                LiquidJS
                <Info className="size-3" aria-hidden="true" />
              </a>{' '}
              · type <span className="text-cs-text-muted">{'{{'}</span> to insert
              {st.dirty && <span className="ml-2 text-cs-warn">● unsaved</span>}
            </span>
          </div>
          <MacroEditor
            value={st.value}
            onChange={st.setValue}
            taRef={st.taRef}
            mode={st.previewMode}
            variables={MACRO_VARIABLES}
            placeholder="{{ sender_name }} @ {{ snr }}snr — on my way"
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_VARS.map((v) => {
              const meta = MACRO_VARIABLES.find((x) => x.name === v);
              const resolved = resolvePath(structureRoot, [v]);
              const chip = (
                <button
                  key={v}
                  type="button"
                  onClick={() => st.insertVar(v)}
                  className="rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1 font-mono text-[11px] text-cs-accent hover:bg-cs-bg-3"
                >
                  {v}
                </button>
              );
              if (!meta) return chip;
              return (
                <HoverCard key={v} openDelay={150} closeDelay={100}>
                  <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
                  <HoverCardContent
                    side="top"
                    align="start"
                    sideOffset={8}
                    collisionPadding={8}
                    className="w-auto max-w-80 p-3"
                  >
                    <VariableHoverCard variable={meta} structure={resolved.ok ? resolved.node : null} />
                  </HoverCardContent>
                </HoverCard>
              );
            })}
          </div>
        </div>

        {/* Preview — stacked under the editor. The Reference lives in the right
            rail; the preview stays here so it keeps receiving validation and
            lint warnings as props, and can't be unmounted by collapsing the rail. */}
        <div className="flex max-h-[45%] shrink-0 flex-col border-t border-cs-border">
          <PreviewPane
            value={st.value}
            mode={st.previewMode}
            onModeChange={st.setPreviewMode}
            distanceUnit={distanceUnit}
            validation={validation}
            warnings={warnings}
          />
        </div>
      </div>
    </div>
  );
}
