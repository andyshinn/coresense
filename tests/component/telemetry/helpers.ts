import { useStore } from '../../../src/renderer/lib/store';
import { describeChannels } from '../../../src/shared/telemetry/describe';
import { bytesToHex, decodeLpp, hexToBytes } from '../../../src/shared/telemetry/lpp';
import type { SavedRequestDto, TelemetrySource } from '../../../src/shared/telemetry/types';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/types';

export { INA3221_FIXTURE, PLAN_FIXTURE, T1000E_REMOTE } from '../../unit/shared/telemetry/fixtures';

const PK = 'aa'.repeat(32);

/** A saved request DTO decoded from `hex` (null = no reply), like main serves it. */
export function dto(
  id: string,
  requestedAt: number,
  hex: string | null,
  over: Partial<SavedRequestDto> = {},
): SavedRequestDto {
  const raw = hex ? hexToBytes(hex) : null;
  const decoded = raw ? decodeLpp(raw) : null;
  const ok = (over.outcome ?? 'ok') === 'ok';
  return {
    id,
    nodeKey: PK,
    source: 'repeater',
    requestedAt,
    repliedAt: ok ? requestedAt + 1800 : null,
    outcome: 'ok',
    roundTripMs: ok ? 1800 : null,
    hops: 0,
    route: 'direct',
    aclRole: 'admin',
    permsGranted: 7,
    rawHex: raw ? bytesToHex(raw) : null,
    readings: decoded?.readings ?? [],
    restHex: decoded ? bytesToHex(decoded.rest) : '',
    ...over,
  };
}

/** Described channel groups of a hex payload. */
export function groups(hex: string, source: TelemetrySource = 'repeater') {
  const raw = hexToBytes(hex);
  if (!raw) throw new Error(`bad hex: ${hex}`);
  return describeChannels(decodeLpp(raw).readings, source);
}

/** Pin the clock preference so rendered times are deterministic. */
export function use24h(): void {
  useStore.setState({ appSettings: { ...DEFAULT_APP_SETTINGS, timeFormat: '24h' } });
}
