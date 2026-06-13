import { KeyRound, LocateFixed, type LucideIcon, MapPin, Megaphone, PowerOff, Radio, RotateCcw } from 'lucide-react';
import type { Owner } from '../../../shared/types';
import { type ApiClient, api } from '../../lib/api';
import { notify } from '../../lib/notify';
import { useStore } from '../../lib/store';
import type { QuickActionId } from './ids';

type StoreState = ReturnType<typeof useStore.getState>;

export interface QuickActionCtx {
  client: ApiClient | null;
  owner: Owner | null;
}

export interface QuickActionDef {
  id: QuickActionId;
  /** Full label — primary button + picker menu. */
  label: string;
  /** Compact label — secondary buttons / a11y. */
  short: string;
  icon: LucideIcon;
  kind: 'action' | 'toggle' | 'danger';
  /** Disabled + dimmed when not connected. `copyKey` is false (needs only an owner). */
  requiresConnection: boolean;
  /** Toggles only — live on/off read from the store for the state dot. */
  getState?: (s: StoreState) => boolean;
  /** When set, the button confirms via a shadcn Popover before running. */
  confirm?: { title: string; body?: string; confirmLabel: string };
  run: (ctx: QuickActionCtx) => void | Promise<void>;
}

const ok = (msg: string) => () => notify.success(msg);
const fail = (label: string) => (err: unknown) => notify.error(`${label} failed: ${(err as Error).message}`, err);

export const QUICK_ACTIONS: QuickActionDef[] = [
  {
    id: 'flood',
    label: 'Flood advert',
    short: 'Flood',
    icon: Megaphone,
    kind: 'action',
    requiresConnection: true,
    run: ({ client }) => {
      if (!client) return;
      return api.sendAdvert(client, true).then(ok('Flood advert sent'), fail('Flood advert'));
    },
  },
  {
    id: 'direct',
    label: 'Direct advert',
    short: 'Direct',
    icon: Radio,
    kind: 'action',
    requiresConnection: true,
    run: ({ client }) => {
      if (!client) return;
      return api.sendAdvert(client, false).then(ok('Direct advert sent'), fail('Direct advert'));
    },
  },
  {
    id: 'gps',
    label: 'Toggle GPS',
    short: 'GPS',
    icon: LocateFixed,
    kind: 'toggle',
    requiresConnection: true,
    getState: (s) => s.gpsConfig.enabled,
    run: ({ client }) => {
      if (!client) return;
      const gps = useStore.getState().gpsConfig;
      return api
        .putGpsConfig(client, { ...gps, enabled: !gps.enabled })
        .then(ok(gps.enabled ? 'GPS turned off' : 'GPS turned on'), fail('Toggle GPS'));
    },
  },
  {
    id: 'shareLoc',
    label: 'Share location in advert',
    short: 'Adv loc',
    icon: MapPin,
    kind: 'toggle',
    requiresConnection: true,
    getState: (s) => s.deviceIdentity.sharePositionInAdvert,
    run: ({ client }) => {
      if (!client) return;
      const cur = useStore.getState().deviceIdentity.sharePositionInAdvert;
      return api
        .putDeviceIdentity(client, { sharePositionInAdvert: !cur })
        .then(ok(cur ? 'Location no longer shared in advert' : 'Location shared in advert'), fail('Update share-location'));
    },
  },
  {
    id: 'copyKey',
    label: 'Copy public key',
    short: 'Key',
    icon: KeyRound,
    kind: 'action',
    requiresConnection: false,
    run: ({ owner }) => {
      if (!owner) return;
      return navigator.clipboard.writeText(owner.publicKeyHex).then(ok('Public key copied'), fail('Copy'));
    },
  },
  {
    id: 'reboot',
    label: 'Reboot radio',
    short: 'Reboot',
    icon: RotateCcw,
    kind: 'action',
    requiresConnection: true,
    confirm: {
      title: 'Reboot radio?',
      body: 'The radio will be unavailable for a few seconds.',
      confirmLabel: 'Reboot',
    },
    run: ({ client }) => {
      if (!client) return;
      return api.rebootDevice(client).then(ok('Reboot requested'), fail('Reboot'));
    },
  },
  {
    id: 'disconnect',
    label: 'Disconnect',
    short: 'Unplug',
    icon: PowerOff,
    kind: 'danger',
    requiresConnection: true,
    confirm: { title: 'Disconnect radio?', confirmLabel: 'Disconnect' },
    run: ({ client }) => {
      if (!client) return;
      return api.disconnect(client).then(ok('Disconnected'), fail('Disconnect'));
    },
  },
];

export const QUICK_ACTIONS_BY_ID: Record<QuickActionId, QuickActionDef> = Object.fromEntries(
  QUICK_ACTIONS.map((a) => [a.id, a]),
) as Record<QuickActionId, QuickActionDef>;
