import { getNameColor } from '../lib/contactColor';

/**
 * A message sender's name, color-coded by `getNameColor`. Shared by the channel
 * conversation view (MessageRow) and the Unreads triage previews so the same
 * sender reads the same colour everywhere.
 */
export function SenderLabel({ name }: { name: string }) {
  const { fg } = getNameColor(name);
  return (
    <span className="text-xs font-medium leading-tight" style={{ color: fg }}>
      {name}
    </span>
  );
}
