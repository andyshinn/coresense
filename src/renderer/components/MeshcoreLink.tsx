import { DeviceRole } from '@michaelhart/meshcore-decoder';
import {
  Activity,
  Copy,
  DoorOpen,
  type LucideIcon,
  MapPin,
  MessageCircle,
  Radio,
  Router,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { decodeMeshcoreUri, type MeshcoreAdvert } from '../lib/meshcoreUri';
import { CopyButton } from './CopyButton';
import { RelativeTime } from './RelativeTime';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

const ROLE_ICON: Record<DeviceRole, LucideIcon> = {
  [DeviceRole.Unknown]: Router,
  [DeviceRole.ChatNode]: MessageCircle,
  [DeviceRole.Repeater]: Radio,
  [DeviceRole.RoomServer]: DoorOpen,
  [DeviceRole.Sensor]: Activity,
};

// Keep clicks inside the link from bubbling to the message row, which would
// otherwise select the message. PopoverContent is portalled, but React still
// propagates synthetic events through the component tree.
const stop = (e: React.MouseEvent) => e.stopPropagation();

interface Props {
  /** The full `meshcore://…` URI as it appeared in the message body. */
  raw: string;
}

/**
 * Renders a `meshcore://` contact-share link as an inline chip. Clicking it
 * opens a popover with the decoded advert (public key, role, location, age).
 * Links that don't decode fall back to plain text — no information is hidden.
 */
export function MeshcoreLink({ raw }: Props) {
  const advert = decodeMeshcoreUri(raw);
  if (!advert) return <span className="break-all">{raw}</span>;

  const Icon = ROLE_ICON[advert.role] ?? Router;
  const label = advert.name ?? `${advert.publicKeyHex.slice(0, 8)}…`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stop}
          title="MeshCore contact — click for details"
          className="inline-flex max-w-full items-center gap-1 rounded border border-cs-border bg-cs-bg-2 px-1.5 py-0.5 align-baseline font-medium text-cs-text transition-colors hover:bg-cs-bg-3"
        >
          <Icon size={12} aria-hidden="true" className="shrink-0 text-cs-accent" />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" onClick={stop} className="flex w-72 flex-col gap-3 text-sm">
        <AdvertDetails advert={advert} Icon={Icon} />
      </PopoverContent>
    </Popover>
  );
}

function AdvertDetails({ advert, Icon }: { advert: MeshcoreAdvert; Icon: LucideIcon }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Icon size={18} aria-hidden="true" className="shrink-0 text-cs-accent" />
        <div className="min-w-0">
          <div className="truncate font-medium text-cs-text">{advert.name ?? 'Unnamed node'}</div>
          <div className="text-xs text-cs-text-dim">{advert.roleName}</div>
        </div>
      </div>

      <Field label="Public key">
        <div className="flex items-start gap-1">
          <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug text-cs-text">
            {advert.publicKeyHex}
          </code>
          <CopyButton
            value={advert.publicKeyHex}
            title="Copy public key"
            className="shrink-0 rounded p-0.5 text-cs-text-dim transition-colors hover:bg-cs-bg-3 hover:text-cs-text"
          >
            <Copy size={12} aria-hidden="true" />
          </CopyButton>
        </div>
      </Field>

      {advert.location && (
        <Field label="Location">
          <a
            href={`https://www.openstreetmap.org/?mlat=${advert.location.lat}&mlon=${advert.location.lon}#map=13/${advert.location.lat}/${advert.location.lon}`}
            target="_blank"
            rel="noreferrer noopener"
            onClick={stop}
            className="inline-flex items-center gap-1 text-cs-accent underline underline-offset-2 hover:opacity-80"
          >
            <MapPin size={12} aria-hidden="true" />
            {advert.location.lat.toFixed(5)}, {advert.location.lon.toFixed(5)}
          </a>
        </Field>
      )}

      <Field label="Advertised">
        <RelativeTime ts={advert.advertisedAt} className="text-cs-text" />
      </Field>

      {advert.signatureValid != null && (
        <div
          className={`inline-flex items-center gap-1 text-xs ${advert.signatureValid ? 'text-cs-online' : 'text-cs-danger'}`}
        >
          {advert.signatureValid ? (
            <ShieldCheck size={12} aria-hidden="true" />
          ) : (
            <ShieldAlert size={12} aria-hidden="true" />
          )}
          {advert.signatureValid ? 'Signature verified' : 'Signature invalid'}
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium tracking-wide text-cs-text-dim uppercase">{label}</span>
      {children}
    </div>
  );
}
