import { useStore } from '../../lib/store';
import { ReferencePanel } from '../../panels/macros/studio/ReferencePanel';

/** Right-rail content for the Macros tool: the open studio's variable & filter
 *  reference. Clicking an entry inserts it into the studio editor via the
 *  bridge the studio publishes to the store. */
export function MacroReferenceRail() {
  const bridge = useStore((s) => s.macroStudioBridge);

  if (!bridge) {
    return <div className="p-4 text-[12px] text-cs-text-dim">Open or create a macro to see its variables and filters.</div>;
  }

  return <ReferencePanel mode={bridge.previewMode} onInsertVar={bridge.insertVar} onInsertFilter={bridge.insertText} />;
}
