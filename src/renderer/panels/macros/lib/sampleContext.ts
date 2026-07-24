import { buildSampleContext, MACRO_VARIABLES } from '../../../../shared/macros';
import type { MacroContext, MacroPath } from '../../../../shared/macros/types';

const REPLY_ONLY_NAMES = MACRO_VARIABLES.filter((v) => v.available === 'reply').map((v) => v.name);

/** Reply preview — a received message is selected, so every variable resolves. */
export function replyContext(): MacroContext {
  return buildSampleContext();
}

/** New-send preview — composing a fresh message, so reply-only variables are
 *  unavailable (null / empty), matching what the real send-context builder
 *  produces. */
export function sendContext(): MacroContext {
  const ctx = buildSampleContext() as unknown as Record<string, unknown>;
  for (const name of REPLY_ONLY_NAMES) ctx[name] = name === 'paths' ? [] : null;
  return ctx as unknown as MacroContext;
}

const WORST_CASE_HOPS = [
  { kind: 'hop' as const, short_id: 'a1', name: 'Tarrytown East Solar', pk: 'a137f2aa' },
  { kind: 'hop' as const, short_id: '37', name: 'SOCO RAK Repeater 🛒', pk: '37c0dd01' },
  { kind: 'hop' as const, short_id: 'a8', name: 'Mt. Bonnell 🗻', pk: 'a8be1100' },
];

const WORST_CASE_PATH: MacroPath = {
  id: 'x',
  length: WORST_CASE_HOPS.length,
  hash_mode: 1,
  final_snr: 11,
  hops: WORST_CASE_HOPS,
  all_hops: [
    { kind: 'origin', short_id: 'c5', name: 'EDM9/R Edwards Mtn', pk: null },
    ...WORST_CASE_HOPS,
    { kind: 'sink', short_id: 'eH', name: 'egrme.sh Hand', pk: null },
  ],
};

/** Worst-case preview — longest plausible values, used to mark where the macro
 *  could land on the budget meter even when the current sample is short. */
export function worstCaseContext(): MacroContext {
  return {
    ...buildSampleContext(),
    my_name: 'egrme.sh Field Station 2',
    my_callsign: 'egrme-2',
    peer_name: 'Tarrytown East Solar Repeater',
    sender_name: 'Tarrytown East Solar Repeater',
    message_body: 'Anyone near Mt Bonnell for a relay test this evening please?',
    received_ago: '14 minutes ago',
    rssi: -118,
    snr: -7.5,
    hops: 7,
    times_heard: 142,
    paths: [WORST_CASE_PATH],
  };
}
