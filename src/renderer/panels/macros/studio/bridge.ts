import type { PreviewMode } from './useStudio';

/** A live handle the open Macro studio publishes to the store so the Reference
 *  panel — rendered in the right rail, a sibling of the center pane — can insert
 *  variables/filters into the studio's editor and track its preview mode. */
export interface MacroStudioBridge {
  previewMode: PreviewMode;
  insertVar: (name: string) => void;
  insertText: (text: string) => void;
}
