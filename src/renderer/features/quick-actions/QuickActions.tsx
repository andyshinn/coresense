import { Settings2 } from 'lucide-react';
import type { Owner } from '../../../shared/types';
import type { ApiClient } from '../../lib/api';
import { useStore } from '../../lib/store';
import { QUICK_ACTIONS_BY_ID, type QuickActionDef } from './catalog';
import { DEFAULT_QUICK_ACTION_IDS, type QuickActionId } from './ids';
import { QuickActionButton } from './QuickActionButton';
import { sanitizeQuickActionIds } from './sanitize';

interface Props {
  owner: Owner | null;
  client: ApiClient | null;
  /** Override the persisted ids (used by the settings-tab live preview). */
  idsOverride?: QuickActionId[];
}

/** The owner-card quick-action block: a primary button + up to three secondary
 *  icon buttons, rendered from the user's configured ids. */
export function QuickActions({ owner, client, idsOverride }: Props) {
  const persisted = useStore((s) => s.appSettings.quickActions);
  const connected = useStore((s) => s.transportState === 'connected');
  const setActiveKey = useStore((s) => s.setActiveKey);

  const ids = idsOverride ?? persisted ?? DEFAULT_QUICK_ACTION_IDS;
  const defs = sanitizeQuickActionIds(ids).map((id) => QUICK_ACTIONS_BY_ID[id]);
  const ctx = { client, owner };
  const hasOwner = !!owner;
  const enabledOf = (d: QuickActionDef) => (d.requiresConnection ? connected : hasOwner);

  return (
    <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wide text-cs-text-dim">
          Quick actions
        </span>
        <button
          type="button"
          title="Configure quick actions"
          aria-label="Configure quick actions"
          onClick={() => setActiveKey('tool:settings:quickActions')}
          className="text-cs-text-dim transition-colors hover:text-cs-text"
        >
          <Settings2 className="size-3" aria-hidden />
        </button>
      </div>

      {defs.length === 0 ? (
        <button
          type="button"
          onClick={() => setActiveKey('tool:settings:quickActions')}
          className="rounded-md border border-dashed border-cs-border px-2 py-1.5 text-[11px] text-cs-text-dim transition-colors hover:text-cs-text"
        >
          Configure quick actions…
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <QuickActionButton
            def={defs[0]}
            ctx={ctx}
            variant="primary"
            enabled={enabledOf(defs[0])}
          />
          {defs.length > 1 && (
            <div className="flex gap-1.5">
              {defs.slice(1).map((d) => (
                <QuickActionButton
                  key={d.id}
                  def={d}
                  ctx={ctx}
                  variant="secondary"
                  enabled={enabledOf(d)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
