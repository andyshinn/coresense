import { Head } from './hoverAtoms';

/** `example` is optional: MeshCore filters are MacroFilterDoc and carry one, the
 *  seven standard-filter rows use a local shape that has no example field. */
export function FilterHoverCard({
  name,
  description,
  signature,
  example,
}: {
  name: string;
  description: string;
  signature: string;
  example?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[12px] text-cs-text">{name}</span>
        <p className="text-[11px] text-cs-text-muted">{description}</p>
      </div>

      <div className="flex flex-col gap-1">
        <Head label="Signature" />
        <code className="break-all font-mono text-[11px] text-cs-text-muted">{signature}</code>
      </div>

      {example && (
        <div className="flex flex-col gap-1">
          <Head label="Example" />
          <code className="break-all font-mono text-[11px] text-cs-text-muted">{example}</code>
        </div>
      )}
    </div>
  );
}
