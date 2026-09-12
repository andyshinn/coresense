import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { makeTestSession } from '../../support/session-harness';

const ADDED = 'a1'.repeat(32); // the radio auto-added this one
const REFUSED = 'b2'.repeat(32); // the radio refused this one

// PUSH_ADVERT: [0x80][pubkey 32B]. The advertiser IS in the radio's contact
// store — including a node it auto-added microseconds ago, which is why the
// pubkey can be one we have never seen.
function pushAdvert(pubkeyHex: string): Buffer {
  return Buffer.concat([Buffer.from([0x80]), Buffer.from(pubkeyHex, 'hex')]);
}

// PUSH_NEW_ADVERT: [0x8a][full 148B contact record] — the radio REFUSED to
// store this node (firmware `BaseChatMesh::onAdvertRecv` refusal paths).
// RESP_CONTACT (0x03) is the same 148-byte layout, only the code differs.
function contactFrame(code: number, pubkeyHex: string, name: string): Buffer {
  const frame = Buffer.alloc(148);
  frame[0] = code;
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  frame[33] = 1; // type = chat
  frame[35] = 0xff; // out_path_len = flood/unknown
  Buffer.from(name, 'utf8').copy(frame, 100);
  return frame;
}

const settleRefresh = () => new Promise((r) => setTimeout(r, 80)); // 50ms debounce + slack

describe('a contact the radio auto-added lands on-radio immediately', () => {
  it('writes on_radio=1 for the PUSH_ADVERT → RESP_CONTACT round trip', async () => {
    const { transport, receive } = makeTestSession();

    receive(pushAdvert(ADDED));
    await settleRefresh();

    // The library re-fetches the full record, because the push carries only the
    // pubkey. That reply is the moment the contact exists for us.
    const asked = transport.sent.some((f) => f[0] === 0x1e && Buffer.from(f).subarray(1, 33).toString('hex') === ADDED);
    expect(asked).toBe(true);

    receive(contactFrame(0x03, ADDED, 'Auto Added'));

    // The library's `contacts` snapshot lands one emit before `contactObserved`,
    // so the holder already knows this is on the radio when the row is created.
    // Deriving membership from the (not yet existing) row wrote 0 here, which
    // put the newest auto-added contact in the Contact Manager's Discovered tab
    // while the same contact sat in the main contact list.
    expect(discoveredStore.get(ADDED)?.on_radio).toBe(1);
    expect(
      stateHolder()
        .getContacts()
        .map((c) => c.publicKeyHex),
    ).toContain(ADDED);
  });

  it('does not need a later, unrelated contact frame to correct the row', async () => {
    const { receive } = makeTestSession();

    receive(pushAdvert(ADDED));
    await settleRefresh();
    receive(contactFrame(0x03, ADDED, 'First'));
    const beforeSecond = discoveredStore.get(ADDED)?.on_radio;

    // A second, unrelated auto-add used to be what finally flushed the first
    // one's flag through — and left ITS own row wrong in turn.
    const other = 'c3'.repeat(32);
    receive(pushAdvert(other));
    await settleRefresh();
    receive(contactFrame(0x03, other, 'Second'));

    expect(beforeSecond).toBe(1);
    expect(discoveredStore.get(other)?.on_radio).toBe(1);
  });
});

describe('a contact the radio refused (PUSH_NEW_ADVERT)', () => {
  it('stays off-radio but still counts as heard', () => {
    const { receive } = makeTestSession();

    receive(contactFrame(0x8a, REFUSED, 'Refused'));

    const row = discoveredStore.get(REFUSED);
    // 0x8a means the radio would not store the node — it belongs in Discovered,
    // not On Radio.
    expect(row?.on_radio).toBe(0);
    // …but we demodulated a real advert, and the Discovered tab's "heard
    // within" filter and default sort are built on this column.
    expect(row?.last_heard_ms).toBeGreaterThan(0);
    expect(
      stateHolder()
        .getContacts()
        .map((c) => c.publicKeyHex),
    ).not.toContain(REFUSED);
  });
});
