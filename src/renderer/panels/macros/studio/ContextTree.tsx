import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { StructureField, StructureNode } from '../../../../shared/macros/structure';
import { typeLabel } from './hoverAtoms';

function isExpandable(node: StructureNode): boolean {
  if (node.kind === 'object') return node.fields.length > 0;
  return node.kind === 'array' && node.element !== null;
}

/** The fields shown when a node is expanded. An array shows its element's
 *  fields — the shape a `map:` or a `.first.` reaches. */
function childrenOf(node: StructureNode): StructureField[] {
  if (node.kind === 'object') return node.fields;
  if (node.kind === 'array' && node.element?.kind === 'object') return node.element.fields;
  return [];
}

/** Liquid path for an array's inner field: `paths` → `paths.first.hops`. */
function childPath(parentPath: string, node: StructureNode, name: string): string {
  return node.kind === 'array' ? `${parentPath}.first.${name}` : `${parentPath}.${name}`;
}

function Row({
  field,
  path,
  depth,
  onInsertPath,
}: {
  field: StructureField;
  path: string;
  depth: number;
  onInsertPath: (p: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = isExpandable(field.node);
  return (
    <>
      <div
        className="flex items-center gap-1 px-3 py-0.5"
        data-testid={`ctx-row-${field.name}`}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        {expandable ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${field.name}`}
            onClick={() => setOpen(!open)}
            className="shrink-0 text-cs-text-dim hover:text-cs-text"
          >
            {open ? (
              <ChevronDown className="size-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <button
          type="button"
          aria-label={`Insert ${path}`}
          onClick={() => onInsertPath(`{{ ${path} }}`)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-cs-bg-3"
        >
          <span className="font-mono text-[11px] text-cs-accent">{field.name}</span>
          <span className="shrink-0 rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-text-muted">
            {typeLabel(field.node, { withLength: true })}
          </span>
          {field.sample !== undefined && (
            <span className="truncate font-mono text-[11px] text-cs-text-muted">{field.sample}</span>
          )}
        </button>
      </div>
      {open &&
        childrenOf(field.node).map((child) => (
          <Row
            key={child.name}
            field={child}
            path={childPath(path, field.node, child.name)}
            depth={depth + 1}
            onInsertPath={onInsertPath}
          />
        ))}
    </>
  );
}

/** Browsable view of the sample context: field, sample type, sample value. */
export function ContextTree({ node, onInsertPath }: { node: StructureNode; onInsertPath: (path: string) => void }) {
  if (node.kind !== 'object') return null;
  return (
    <div className="py-1">
      {node.fields.map((f) => (
        <Row key={f.name} field={f} path={f.name} depth={0} onInsertPath={onInsertPath} />
      ))}
    </div>
  );
}
