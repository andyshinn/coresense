import { buildSampleContext, MACRO_VARIABLES } from '../../../../shared/macros';
import type { MacroContext, MacroPath } from '../../../../shared/macros/types';

const REPLY_ONLY_NAMES = MACRO_VARIABLES.filter((v) => v.available === 'reply').map((v) => v.name);

/** Variables the manifest documents but nothing ever populates — see their
 *  entries for why. buildSampleContext() gives them plausible numbers because
 *  the lint root and validateTemplate need a complete shape; a preview must not
 *  repeat the fiction. Rendering `-80` for `{{ peer_rssi }}` in a pane whose
 *  whole job is "this is what you are about to transmit" is how someone ships a
 *  macro that sends "?dBm" to the mesh. Blanking them here makes the preview
 *  agree with the real send — the placeholder is what renderTemplate produces
 *  for a null, so the previewed text and its budget length are both honest. */
const NEVER_POPULATED_NAMES = MACRO_VARIABLES.filter((v) => v.populated === false).map((v) => v.name);

/** Null out the never-populated variables. Applied LAST, after any overrides, so
 *  a hand-written sample below cannot quietly re-introduce one. */
function blankNeverPopulated(ctx: MacroContext): MacroContext {
  const out = ctx as unknown as Record<string, unknown>;
  for (const name of NEVER_POPULATED_NAMES) out[name] = null;
  return out as unknown as MacroContext;
}

/** Reply preview — a received message is selected, so every variable that can
 *  resolve does. */
export function replyContext(): MacroContext {
  return blankNeverPopulated(buildSampleContext());
}

/** New-send preview — composing a fresh message, so reply-only variables are
 *  unavailable (null / empty), matching what the real send-context builder
 *  produces. */
export function sendContext(): MacroContext {
  const ctx = buildSampleContext() as unknown as Record<string, unknown>;
  for (const name of REPLY_ONLY_NAMES) ctx[name] = name === 'paths' ? [] : null;
  return blankNeverPopulated(ctx as unknown as MacroContext);
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
 *  could land on the budget meter even when the current sample is short. The
 *  never-populated variables are blanked here too: their longest possible render
 *  is the one-character placeholder, so padding the meter with a four-character
 *  `-118` would overstate a budget the radio will never spend. */
export function worstCaseContext(): MacroContext {
  return blankNeverPopulated({
    ...buildSampleContext(),
    my_name: 'egrme.sh Field Station 2',
    my_callsign: 'egrme-2',
    peer_name: 'Tarrytown East Solar Repeater',
    sender_name: 'Tarrytown East Solar Repeater',
    message_body: 'Anyone near Mt Bonnell for a relay test this evening please?',
    received_ago: '14 minutes ago',
    snr: -7.5,
    hops: 7,
    times_heard: 142,
    paths: [WORST_CASE_PATH],
  });
}
