import { MessageSquare, Star, X } from 'lucide-react';
import { type Contact, hasValidFix } from '../../../shared/types';
import { MARKER_TYPES, MarkerShape } from '../../components/map/markers/MarkerShape';
import { Button } from '../../components/ui/button';
import { type ApiClient, api } from '../../lib/api';
import { publish as publishMapBus } from '../../lib/map/bus';
import { useStore } from '../../lib/store';
import { fmtRelative } from '../../lib/time';

interface Props {
  contact: Contact;
  client: ApiClient | null;
}

export function NodeInfoCard({ contact, client }: Props) {
  const setSelectedContact = useStore((s) => s.setSelectedContact);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const togglePin = useStore((s) => s.togglePin);
  const meta = MARKER_TYPES[contact.kind];

  const onClose = () => setSelectedContact(null);
  const onMessage = () => {
    setActiveKey(contact.key);
  };
  const onTracePath = () => {
    if (hasValidFix(contact)) {
      publishMapBus({ kind: 'flyTo', lng: contact.gpsLon, lat: contact.gpsLat, zoom: 14 });
    }
  };
  const onStar = () => {
    togglePin(contact.key);
    if (client) {
      // togglePin updates ui state synchronously; persist after.
      const next = useStore.getState().ui;
      void api.putUiState(client, next);
    }
  };

  return (
    <div className="border-b border-cs-border px-3 pb-3 pt-3">
      <div className="mb-2 flex items-start gap-2.5">
        <MarkerShape type={contact.kind} size={22} ariaLabel={meta.label} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-tight text-cs-text">
            {contact.name}
          </div>
          <div
            className="mt-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ color: meta.color }}
          >
            {meta.label}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-0.5 text-cs-text-dim hover:bg-cs-bg-3 hover:text-cs-text"
        >
          <X size={12} />
        </button>
      </div>

      <dl className="space-y-1.5 font-mono text-[11px]">
        <Field k="pubkey" v={shortPk(contact.publicKeyHex)} />
        <Field k="last seen" v={contact.lastSeenMs ? fmtRelative(contact.lastSeenMs) : '—'} />
        <Field
          k="lat,lon"
          v={
            hasValidFix(contact)
              ? `${contact.gpsLat.toFixed(5)}, ${contact.gpsLon.toFixed(5)}`
              : '—'
          }
        />
      </dl>

      <div className="mt-3 flex gap-1.5">
        <Button size="sm" onClick={onMessage} className="flex-1">
          <MessageSquare className="size-3.5" /> Message
        </Button>
        <Button size="sm" variant="outline" onClick={onTracePath} className="flex-1">
          Trace path
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onStar}
          aria-pressed={Boolean(contact.pinned)}
          aria-label={contact.pinned ? 'Unstar' : 'Star'}
          className="px-2"
        >
          <Star className={contact.pinned ? 'size-3.5 fill-current' : 'size-3.5'} />
        </Button>
      </div>
    </div>
  );
}

function shortPk(hex: string): string {
  if (hex.length <= 18) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-8)}`;
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[10px] uppercase tracking-wider text-cs-text-dim">{k}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-[11px] text-cs-text">{v}</dd>
    </div>
  );
}
