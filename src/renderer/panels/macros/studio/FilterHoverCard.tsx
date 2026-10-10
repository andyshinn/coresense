import type { MacroFilterDoc } from '../../../../shared/macros/types';
import { Head } from './hoverAtoms';

/** The example section shows only when the doc has one: the MeshCore filters
 *  do, the standard-filter docs don't. */
export function FilterHoverCard({ doc }: { doc: MacroFilterDoc }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[12px] text-cs-text">{doc.name}</span>
        <p className="text-[11px] text-cs-text-muted">{doc.description}</p>
      </div>

      <div className="flex flex-col gap-1">
        <Head label="Signature" />
        <code className="break-all font-mono text-[11px] text-cs-text-muted">{doc.signature}</code>
      </div>

      {doc.example && (
        <div className="flex flex-col gap-1">
          <Head label="Example" />
          <code className="break-all font-mono text-[11px] text-cs-text-muted">{doc.example}</code>
        </div>
      )}
    </div>
  );
}
