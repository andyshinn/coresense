import type { StructureNode } from '../../../../shared/macros/structure';

/** Section heading, shared by both hover cards. */
export function Head({ label }: { label: string }) {
  return <div className="font-mono text-[10px] uppercase tracking-wider text-cs-text-muted">{label}</div>;
}

/** Human label for a node's shape — `string`, or `string|null` when the sample
 *  proves the field can be absent. `withLength` adds an array's sample count:
 *  useful in the browsable Context tree, noise in a hover card. */
export function typeLabel(node: StructureNode, opts: { withLength?: boolean } = {}): string {
  if (node.kind === 'array') return opts.withLength ? `array[${node.length}]` : 'array';
  if (node.kind === 'object') return 'object';
  return node.nullable ? `${node.type}|null` : node.type;
}
