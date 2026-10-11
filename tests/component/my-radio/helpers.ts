import { useStore } from '../../../src/renderer/lib/store';
import type { SavedRequestDto } from '../../../src/shared/telemetry/types';
import {
  type Contact,
  DEFAULT_APP_SETTINGS,
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_GPS_CONFIG,
  type TelemetryPolicy,
} from '../../../src/shared/types';
import { dto } from '../telemetry/helpers';

export const OWN = 'ab'.repeat(32);
export const client = { baseUrl: 'http://x', apiKey: 'k' };

/** A self read: ch 1 battery 4.04 V; ch 2 27.8 °C, 46% (an AHT/SHT field set). */
export const SELF_HEX = '01 74 01 94 02 67 01 16 02 68 5C';
/** The same, with a GPS fix on ch 1. */
export const SELF_GPS_HEX = '01 74 01 94 01 88 04 9C 22 F1 15 2A 00 41 C8 02 67 01 16';

export function selfRead(
  id: string,
  requestedAt: number,
  hex: string | null = SELF_HEX,
  over: Partial<SavedRequestDto> = {},
) {
  return dto(id, requestedAt, hex, {
    nodeKey: OWN,
    source: 'companion',
    route: 'local',
    hops: null,
    aclRole: null,
    roundTripMs: 120,
    ...over,
  });
}

export const chat = (hex: string, name: string, perms?: Contact['telemetryPerms']): Contact => ({
  key: `c:${hex.repeat(32)}`,
  publicKeyHex: hex.repeat(32),
  name,
  kind: 'chat',
  telemetryPerms: perms,
});

interface SeedOptions {
  reads?: SavedRequestDto[];
  connected?: boolean;
  owner?: boolean;
  policy?: Partial<TelemetryPolicy>;
  contacts?: Contact[];
  gpsIntervalSec?: number;
}

/** A connected companion with an owner, loaded reads and a known policy. */
export function seedRadio({
  reads = [],
  connected = true,
  owner = true,
  policy = {},
  contacts = [],
  gpsIntervalSec = 300,
}: SeedOptions = {}): void {
  useStore.setState({
    appSettings: { ...DEFAULT_APP_SETTINGS, timeFormat: '24h' },
    owner: owner ? { name: 'egrme.sh Hand', publicKeyHex: OWN, publicKeyShort: OWN.slice(0, 12) } : null,
    transportState: connected ? 'connected' : 'idle',
    deviceIdentity: { ...DEFAULT_DEVICE_IDENTITY, lat: null, lon: null },
    gpsConfig: { ...DEFAULT_GPS_CONFIG, intervalSec: gpsIntervalSec },
    telemetryPolicy: { base: 2, loc: 1, env: 1, multiAcks: 1, ...policy },
    contacts,
    discovered: [],
    packets: [],
    telemetryByNode: { [OWN]: reads },
    telemetryLoaded: { [OWN]: true },
    telemetryInFlight: [],
    telemetrySelectedId: {},
    telemetryCompare: {},
    telemetryFetchLedger: {},
  });
}
