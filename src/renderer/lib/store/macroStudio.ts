import type { MacroRenderMode } from '../../../shared/macros/types';
import type { SliceCreator } from './coreState';
import type { MacroStudioBridge } from './types';

/** What the open Macro studio publishes for the right-rail Reference panel. */
export interface MacroStudioSlice {
  // Live handle published by the open Macro studio so the right-rail Reference
  // panel can insert into its editor. Null when no studio is open. Not persisted.
  macroStudioBridge: MacroStudioBridge | null;
  setMacroStudioBridge: (bridge: MacroStudioBridge | null) => void;
  /** The open studio's preview mode, for the Reference panel's sample context:
   *  which context the studio previews a macro against, replying to a message
   *  or a fresh send. Only meaningful while `macroStudioBridge` is set.
   *  Deliberately its own field: setting it never touches `ui`, so toggling the
   *  mode can't re-open a rail the user collapsed. */
  macroStudioPreviewMode: MacroRenderMode;
  setMacroStudioPreviewMode: (mode: MacroRenderMode) => void;
}

export const createMacroStudioSlice: SliceCreator<MacroStudioSlice> = (set) => ({
  macroStudioBridge: null,
  macroStudioPreviewMode: 'send',

  setMacroStudioBridge: (bridge) =>
    set((s) => ({
      macroStudioBridge: bridge,
      // Opening a macro surfaces its Reference in the rail, so make sure the
      // rail is open (open-only — never auto-collapses).
      ui: bridge ? { ...s.ui, rightOpen: true } : s.ui,
    })),
  setMacroStudioPreviewMode: (mode) => set(() => ({ macroStudioPreviewMode: mode })),
});
