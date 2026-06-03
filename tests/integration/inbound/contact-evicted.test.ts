import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { bus, emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { discoveredStore } from '../../../src/main/storage/discoveredContacts';
import { companionPacket } from '../../support/fake-transport';

const PUBKEY = 'bb'.repeat(32);

function contactDeletedFrame(pubkeyHex: string): Buffer {
  const frame = Buffer.alloc(1 + 32);
  frame[0] = 0x8f; // PUSH_CODE_CONTACT_DELETED
  Buffer.from(pubkeyHex, 'hex').copy(frame, 1);
  return frame;
}

describe('inbound PUSH_CONTACT_DELETED', () => {
  afterEach(() => protocolSession().stop());

  it('removes the contact and emits contactEvicted with its name', () => {
    const session = protocolSession();
    session.start();
    discoveredStore.upsert(
      {
        publicKeyHex: PUBKEY,
        type: 1,
        flags: 0,
        outPathLen: 0xff,
        outPathHex: '',
        name: 'Bob',
        lastAdvertUnix: 0,
        gpsLat: 0,
        gpsLon: 0,
        lastmod: 0,
      },
      { onRadio: true, nowMs: 1_700_000_000_000, heardLive: false },
    );

    const evicted: string[] = [];
    bus.on('contactEvicted', (name: string) => evicted.push(name));

    emit.packet(companionPacket(contactDeletedFrame(PUBKEY)));

    expect(evicted).toEqual(['Bob']);
    expect(discoveredStore.get(PUBKEY)?.on_radio).toBe(0);
  });
});
