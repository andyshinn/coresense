import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { emit } from '../../../src/main/events/bus';
import { protocolSession } from '../../../src/main/protocol';
import { messagesStore } from '../../../src/main/storage/messages';
import { transportManager } from '../../../src/main/transport/manager';
import { companionPacket, FakeTransport } from '../../support/fake-transport';

// onPacket is a three-tier router: (1) solicited typed replies (pendingTyped),
// (2) the feature registry, (3) the shared RESP_OK/RESP_ERR ack channel. Any
// code that matches none of those is a deliberate no-op — these tests pin that
// contract so a future "default: throw" can't silently break unknown frames.
describe('inbound dispatch contract', () => {
  afterEach(() => protocolSession().stop());

  it('ignores an unclaimed code without throwing and keeps dispatching after', () => {
    transportManager.setTransport(new FakeTransport());
    const session = protocolSession();
    session.start();

    // 0x7e is owned by no feature and is not RESP_OK/RESP_ERR.
    expect(() => emit.packet(companionPacket(Buffer.from([0x7e, 0x01, 0x02])))).not.toThrow();

    // A not-yet-implemented RESP (EXPORT_CONTACT 0x0b) is also a safe no-op.
    expect(() => emit.packet(companionPacket(Buffer.from([0x0b, 0x00])))).not.toThrow();

    // The session still routes a real frame afterwards: a channel message for a
    // known slot lands in the store.
    session.markChannelPresent({ key: 'ch:General', name: 'General', kind: 'public', idx: 0 });
    const body = Buffer.from('Alice: hi', 'utf8');
    const chMsg = Buffer.alloc(11 + body.length);
    chMsg[0] = 0x11; // RESP_CHANNEL_MSG_RECV_V3
    chMsg[4] = 0; // idx
    chMsg[5] = 0xff; // direct
    chMsg.writeUInt32LE(1_700_000_000, 7);
    body.copy(chMsg, 11);
    emit.packet(companionPacket(chMsg));

    expect(messagesStore.byKey('ch:General')).toHaveLength(1);
  });

  it('ignores a companion packet with no code', () => {
    transportManager.setTransport(new FakeTransport());
    const session = protocolSession();
    session.start();
    expect(() =>
      emit.packet({
        timestamp: 0,
        transportType: 'ble',
        kind: 'companion',
        hex: '',
        bytes: [],
        payloadHex: '',
        payloadBytes: [],
        code: undefined,
      }),
    ).not.toThrow();
  });
});
