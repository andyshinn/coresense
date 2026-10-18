import { useState } from 'react';
import type { MacroTemplate } from '../../../shared/macros/types';
import { MacroLibrary } from './MacroLibrary';
import { MacroStudio } from './MacroStudio';

type View = { kind: 'library' } | { kind: 'studio'; macro: MacroTemplate | null };

/** The Macros tool — a library list that swaps to the authoring studio when
 *  creating or editing a macro. */
export function MacrosPanel() {
  const [view, setView] = useState<View>({ kind: 'library' });

  if (view.kind === 'studio') {
    return <MacroStudio macro={view.macro} onClose={() => setView({ kind: 'library' })} />;
  }

  return (
    <MacroLibrary
      onNew={() => setView({ kind: 'studio', macro: null })}
      onEdit={(m) => setView({ kind: 'studio', macro: m })}
    />
  );
}
