// The connected radio's own counters (CMD_GET_STATS), for My Node's Radio
// stats card.
//
// meshcore-ts keeps ONE pending GET_STATS and rejects an earlier call with
// "superseded by newer GET_STATS" when another starts, so the three subtypes
// are always read one after another, never in parallel. This is the only
// caller of repeaterGetLocalStats.

import type { DeviceStats, LocalStats, LocalStatsCore, LocalStatsPackets, LocalStatsRadio } from '../../shared/types';
import type { SessionAdapter } from '../protocol/sessionAdapter';

export type LocalStatsSession = Pick<SessionAdapter, 'repeaterGetLocalStats'>;

/** Thrown when `shouldStop` asked to give up between subtypes. */
export class LocalStatsSkipped extends Error {
  constructor() {
    super('stats read skipped');
    this.name = 'LocalStatsSkipped';
  }
}

function expectKind<K extends LocalStats['kind']>(stats: LocalStats, kind: K): Extract<LocalStats, { kind: K }> {
  if (stats.kind !== kind) throw new Error(`GET_STATS answered ${stats.kind}, expected ${kind}`);
  return stats as Extract<LocalStats, { kind: K }>;
}

/** Read core, radio and packets in sequence. `shouldStop` is checked before
 *  each subtype, so a caller can step aside for a user command mid-read; it
 *  throws LocalStatsSkipped then. Any library rejection propagates. */
export async function readLocalStats(
  session: LocalStatsSession,
  opts: { shouldStop?: () => boolean } = {},
): Promise<DeviceStats> {
  const step = async <K extends LocalStats['kind']>(subtype: 'CORE' | 'RADIO' | 'PACKETS', kind: K) => {
    if (opts.shouldStop?.()) throw new LocalStatsSkipped();
    return expectKind((await session.repeaterGetLocalStats(subtype)) as LocalStats, kind);
  };
  const core: LocalStatsCore = await step('CORE', 'core');
  const radio: LocalStatsRadio = await step('RADIO', 'radio');
  const packets: LocalStatsPackets = await step('PACKETS', 'packets');
  return { core, radio, packets, at: Date.now() };
}
