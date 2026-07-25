import type { StructureNode } from '../../../../shared/macros/structure';
import type { MacroVariable } from '../../../../shared/macros/types';
import { Head, typeLabel } from './hoverAtoms';

const TYPE_LABEL: Record<MacroVariable['type'], string> = {
  string: 'string',
  number: 'number',
  position: 'position',
  array: 'array',
  boolean: 'boolean',
};

/** Field names + types, two levels deep. Arrays show their element's fields —
 *  one level of `paths` would only say `hops: array`, which is exactly the dead
 *  end this feature exists to remove. Depth is capped so a card stays readable. */
function Fields({ node, depth = 0 }: { node: StructureNode; depth?: number }) {
  const target = node.kind === 'array' ? node.element : node;
  if (target?.kind !== 'object') return null;
  return (
    <div className="flex flex-col gap-0.5">
      {target.fields.map((f) => {
        const nested = depth < 1 && (f.node.kind === 'object' || (f.node.kind === 'array' && f.node.element !== null));
        return (
          <div key={f.name} className="flex flex-col" style={{ paddingLeft: depth * 10 }}>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-cs-text">{f.name}</span>
              <span className="font-mono text-[11px] text-cs-text-muted">{typeLabel(f.node)}</span>
            </div>
            {nested && <Fields node={f.node} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

export function VariableHoverCard({ variable, structure }: { variable: MacroVariable; structure: StructureNode | null }) {
  const showStructure =
    structure !== null && (structure.kind === 'object' || (structure.kind === 'array' && structure.element !== null));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-cs-accent">{variable.name}</span>
          <span className="rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-text-muted">
            {TYPE_LABEL[variable.type]}
          </span>
          {variable.available === 'reply' && (
            <span className="rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-warn">reply only</span>
          )}
        </div>
        <p className="text-[11px] text-cs-text-muted">{variable.description}</p>
      </div>

      {showStructure && structure && (
        <div className="flex flex-col gap-1">
          <Head label="Structure" />
          <Fields node={structure} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Head label="Example" />
        <code className="break-all font-mono text-[11px] text-cs-text-muted">{variable.example}</code>
      </div>
    </div>
  );
}
