import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setProtocolSession } from '../../../src/main/protocol';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import { DEFAULT_AUTO_ADD_CONFIG } from '../../../src/shared/types';
import { frameBuf } from '../../support/frames';
import { makeTestSession, type TestSession } from '../../support/session-harness';

// meshcore-ts 0.8.1's second fix, seen from coresense.
//
// The library's post-advert re-sync was gated on `AutoAddConfig.mode` — app-side
// state nothing in the library ever assigns. That was inert while the library
// hardcoded manual_add_contacts to 0: the radio auto-added everything, so
// adverts arrived as on-radio PUSH_ADVERT and never reached the gate. 0.8.0 let
// coresense set bit 0, which its auto-add panel now does, and from then on a
// REFUSED advert (PUSH_NEW_ADVERT, not on radio) reached the gate and scheduled
// a full CMD_GET_CONTACTS walk behind a 1.5s debounce — for a contact the radio
// had already declined to store, over and over on a busy mesh.
//
// Reachable from here because SessionAdapter.start() seeds the library mirror
// from coresense's persisted AutoAddConfig, so these drive the real wiring.

const REPEATER_PK = 'b4'.repeat(32);
const CHAT_PK = 'c5'.repeat(32);

const ADV_TYPE_CHAT = 1;
const ADV_TYPE_REPEATER = 2;

/** PUSH_NEW_ADVERT (0x8a): a node we heard that the radio did NOT store. */
function newAdvertFrame(pubkeyHex: string, advType: number, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = 0x8a;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = advType;
  frame[35] = 0xff; // out_path_len = OUT_PATH_UNKNOWN
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

/** RESP_SELF_INFO (0x05) with `_prefs.manual_add_contacts` (byte 47) overridden.
 *  The real captured frame, so the other 70 bytes are whatever a radio actually
 *  sends. */
function selfInfoWithManualAdd(manualAddContacts: number): Buffer {
  const frame = Buffer.from(frameBuf('selfInfo'));
  frame[47] = manualAddContacts;
  return frame;
}

/** CMD_GET_CONTACTS (0x04) — the full-store walk the re-sync issues. */
const getContactsCommands = (s: TestSession) => s.transport.sent.filter((f) => f[0] === 0x04);

/** The library debounces the re-sync by 1.5s. */
const RESYNC_DEBOUNCE_MS = 1500;

/** Persist an auto-add config, THEN build the session: start() seeds the
 *  library mirror from the holder, so the order matters. */
function sessionWith(cfg: Partial<typeof DEFAULT_AUTO_ADD_CONFIG>): TestSession {
  stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG, ...cfg });
  const s = makeTestSession();
  transportManager.setState('connected');
  setProtocolSession(s.adapter);
  return s;
}

afterEach(() => {
  setProtocolSession(null);
  transportManager.setState('idle');
  vi.useRealTimers();
});

describe('post-advert contact re-sync gate', () => {
  // THE case the library fix is for, and the only one that separates 0.8.0 from
  // 0.8.1 from this side.
  //
  // The radio reports its manual-add bit in RESP_SELF_INFO byte 47, and the
  // library folds that byte into its mirror WITHOUT touching the mirror's
  // `mode` — which start() seeded from our persisted config, where 'all' is the
  // default. So the moment a radio says "I am in per-kind mode" to an app whose
  // stored mode still says 'all', the library's two notions of the same switch
  // disagree, and 0.8.0 believed the one the radio never sets.
  //
  // Not a contrived state: coresense DERIVES its own mode from that byte
  // (adapterEvents) precisely because the byte is the authority, and the byte
  // can change under us — another client, or the firmware's own config — inside
  // a session that started with the bit clear.
  it('does not re-sync for a deselected kind when the RADIO reports per-kind mode', async () => {
    vi.useFakeTimers();
    const s = sessionWith({ mode: 'all', manualAddContacts: 0, repeater: false });

    // The radio speaks: bit 0 set, honour the per-kind flags.
    s.receive(selfInfoWithManualAdd(1));
    // And a repeater advert it refused, on a rule the user set.
    s.receive(newAdvertFrame(REPEATER_PK, ADV_TYPE_REPEATER, 'Hilltop'));
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS * 2);

    // Re-enumerating the radio's whole contact store cannot produce a contact
    // it declined to store. On 0.8.0 this scheduled one per refused advert.
    expect(getContactsCommands(s)).toHaveLength(0);
  });

  it('still re-syncs for a SELECTED kind the radio refused', async () => {
    vi.useFakeTimers();
    const s = sessionWith({ mode: 'all', manualAddContacts: 0, chat: true, repeater: false });

    s.receive(selfInfoWithManualAdd(1));
    s.receive(newAdvertFrame(CHAT_PK, ADV_TYPE_CHAT, 'Erin'));
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS * 2);

    // Chat is enabled, so the radio should have stored this one — the walk is
    // how we pick it up. The fix must not have closed the gate wholesale.
    expect(getContactsCommands(s)).toHaveLength(1);
  });

  // The control in the other direction: bit 0 CLEAR means the firmware auto-adds
  // everything and its per-kind flags are inert (MyMesh::shouldAutoAddContactType
  // returns true before it reads autoadd_config), so `repeater: false` is a
  // stale app-side opinion the gate must not act on.
  it('ignores the per-kind flags when the radio is not in per-kind mode', async () => {
    vi.useFakeTimers();
    const s = sessionWith({ mode: 'all', manualAddContacts: 0, repeater: false });

    s.receive(newAdvertFrame(REPEATER_PK, ADV_TYPE_REPEATER, 'Hilltop'));
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS * 2);

    expect(getContactsCommands(s)).toHaveLength(1);
  });

  // The seeded `mode` must not close a gate the radio left open — the direction
  // that is easy to get wrong, because suppressing looks like the safe default.
  //
  // 0.8.1 consults ONLY the radio byte. An earlier candidate for the same fix
  // kept `|| mode === 'selected'` as a narrowing fallback, on the theory that an
  // app that deliberately saved "Selected" should keep its per-kind
  // consultation. That is wrong from here, and coresense is the library's
  // evidence for why: `{mode: 'selected', manualAddContacts: 0}` is a state our
  // own storage layer documents as legitimate and mid-flight — see
  // tests/unit/main/storage/auto-add-config-migration.test.ts, "never overrides
  // a byte the radio has already reported": the radio said "I auto-add
  // everything", and the user has not saved their new selection yet. The radio
  // really would have stored this contact, so our map really is behind it, and
  // the walk is the only thing that catches up. A narrowing fallback would
  // suppress it on the strength of app-side state the radio has already
  // contradicted.
  //
  // `mode` is a VIEW of bit 0 here (adapterEvents derives it, the migration
  // seeds it), never an independent switch — so pinning this keeps the library
  // gate and coresense's own model reading the same byte.
  it('does not let a stale selected mode suppress a walk the radio byte allows', async () => {
    vi.useFakeTimers();
    const s = sessionWith({ mode: 'selected', manualAddContacts: 0, repeater: false });

    s.receive(newAdvertFrame(REPEATER_PK, ADV_TYPE_REPEATER, 'Hilltop'));
    await vi.advanceTimersByTimeAsync(RESYNC_DEBOUNCE_MS * 2);

    // Bit 0 is clear, so `repeater: false` is a stale app-side opinion the radio
    // does not share: it auto-adds every kind and the per-kind flags are inert.
    expect(getContactsCommands(s)).toHaveLength(1);
  });
});
