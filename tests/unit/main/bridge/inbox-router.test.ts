import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The channel-send echo looks the channel up in the holder; with no channel it
// skips the local echo, which is all these tests need from it.
vi.mock('../../../../src/main/state/holder', () => ({ stateHolder: () => ({ getChannels: () => [] }) }));

import { InboxRouter } from '../../../../src/main/bridge/drain';
import type { BridgeClient } from '../../../../src/main/bridge/hub';

const { CMD, RESP, PUSH } = Protocol;

const GET_NEXT = Buffer.from([CMD.GET_NEXT_MSG]);
const NO_MORE = Buffer.from([RESP.NO_MORE_MESSAGES]);
const MSG_WAITING = Buffer.from([PUSH.MSG_WAITING]);
const DAY_MS = 24 * 60 * 60 * 1000;

/** A message-bearing device frame; the router keys on the code byte only. */
const msg = (n: number) => Buffer.from([RESP.CONTACT_MSG_RECV_V3, n]);

/** CMD_APP_START: [0x01][version][6 reserved bytes][app name]. */
const appStart = (name: string) =>
  Buffer.concat([Buffer.from([CMD.APP_START, 0x01, 0, 0, 0, 0, 0, 0]), Buffer.from(name, 'utf8')]);

interface FakeClient extends BridgeClient {
  received: Buffer[];
}

function client(ip: string, id = ip): FakeClient {
  const received: Buffer[] = [];
  return {
    id,
    kind: 'tcp',
    remoteAddr: `${ip}:5000`,
    remoteIp: ip,
    received,
    send: (payload) => void received.push(Buffer.from(payload)),
    close: () => {},
  };
}

function router() {
  const forwardToDevice = vi.fn<(client: BridgeClient, payload: Buffer) => void>();
  const r = new InboxRouter({ forwardToDevice, log: { trace: () => {}, debug: () => {} } });
  /** A client sends one frame; the router either answers it or lets it through. */
  const fromClient = (c: BridgeClient, payload: Buffer) => r.handleClientFrame(c, payload);
  /** The device emits one frame. */
  const fromDevice = (bytes: Buffer) => r.handleDeviceFrame(bytes[0], bytes);
  return { r, forwardToDevice, fromClient, fromDevice };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('InboxRouter: draining the device queue', () => {
  it('answers GET_NEXT_MSG itself and forwards it to the device only on a cache miss', () => {
    const { r, forwardToDevice, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    r.addClient(a);

    expect(fromClient(a, GET_NEXT)).toBe('handled');
    expect(forwardToDevice).toHaveBeenCalledTimes(1);
    expect(forwardToDevice.mock.calls[0][1]).toEqual(GET_NEXT);

    expect(fromDevice(msg(1))).toBe('consumed');
    expect(a.received).toEqual([msg(1)]);
  });

  // The device has ONE queue and one 0x0a pops one message. Two outstanding
  // requests would hand the second reply to whichever client asked first.
  it('keeps a single GET_NEXT_MSG outstanding however many clients drain at once', () => {
    const { r, forwardToDevice, fromClient } = router();
    const clients = [client('10.0.0.1'), client('10.0.0.2'), client('10.0.0.3')];
    for (const c of clients) r.addClient(c);

    for (const c of clients) fromClient(c, GET_NEXT);

    expect(forwardToDevice).toHaveBeenCalledTimes(1);
  });

  // The bug this router exists for: whoever drains first used to take the
  // message away from everyone else.
  it('lets two clients drain without stealing each other’s messages', () => {
    const { r, forwardToDevice, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    const b = client('10.0.0.2');
    r.addClient(a);
    r.addClient(b);

    fromClient(a, GET_NEXT); // leader: goes to the device
    fromClient(b, GET_NEXT); // parked behind it
    fromDevice(msg(1));

    // B is served the same message from the cache, not from the device.
    expect(a.received).toEqual([msg(1)]);
    expect(b.received).toEqual([msg(1)]);
    expect(forwardToDevice).toHaveBeenCalledTimes(1);

    fromClient(a, GET_NEXT);
    expect(forwardToDevice).toHaveBeenCalledTimes(2);
    fromDevice(NO_MORE);
    expect(a.received.at(-1)).toEqual(NO_MORE);

    // Once the device has said it is empty, a caught-up client is answered
    // locally instead of costing another round trip.
    fromClient(b, GET_NEXT);
    expect(b.received.at(-1)).toEqual(NO_MORE);
    expect(forwardToDevice).toHaveBeenCalledTimes(2);
  });

  it('answers clients parked behind the leader when the device runs dry', () => {
    const { r, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    const b = client('10.0.0.2');
    r.addClient(a);
    r.addClient(b);

    fromClient(a, GET_NEXT);
    fromClient(b, GET_NEXT);
    fromDevice(NO_MORE);

    expect(a.received).toEqual([NO_MORE]);
    expect(b.received).toEqual([NO_MORE]);
  });

  it('starts asking the device again after PUSH_MSG_WAITING', () => {
    const { r, forwardToDevice, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    r.addClient(a);
    fromClient(a, GET_NEXT);
    fromDevice(NO_MORE);

    expect(fromDevice(MSG_WAITING)).toBe('fanout');
    fromClient(a, GET_NEXT);

    expect(forwardToDevice).toHaveBeenCalledTimes(2);
  });

  it('hands the next request to a parked client when the leader disconnects', () => {
    const { r, forwardToDevice, fromClient } = router();
    const a = client('10.0.0.1');
    const b = client('10.0.0.2');
    r.addClient(a);
    r.addClient(b);
    fromClient(a, GET_NEXT);
    fromClient(b, GET_NEXT);

    r.removeClient(a);

    expect(forwardToDevice).toHaveBeenCalledTimes(2);
    expect(forwardToDevice.mock.calls[1][0]).toBe(b);
  });
});

describe('InboxRouter: per-client cursors', () => {
  it('replays the whole cached backlog to a client it has never seen', () => {
    const { r, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    r.addClient(a);
    fromClient(a, GET_NEXT);
    fromDevice(msg(1));
    fromClient(a, GET_NEXT);
    fromDevice(msg(2));

    const late = client('10.0.0.9');
    r.addClient(late);

    // Prompted to drain, then served both from the cache.
    expect(late.received).toEqual([MSG_WAITING]);
    fromClient(late, GET_NEXT);
    fromClient(late, GET_NEXT);
    expect(late.received.slice(1)).toEqual([msg(1), msg(2)]);
  });

  it('resumes a reconnecting client from its cursor instead of replaying what it read', () => {
    const { r, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    const b = client('10.0.0.2');
    r.addClient(a);
    r.addClient(b);
    fromClient(a, GET_NEXT);
    fromDevice(msg(1)); // A has read message 1
    r.removeClient(a);
    fromClient(b, GET_NEXT); // B reads message 1 from the cache
    fromClient(b, GET_NEXT);
    fromDevice(msg(2)); // and drains message 2 while A is away

    const back = client('10.0.0.1', 'a-again');
    r.addClient(back);
    fromClient(back, GET_NEXT);

    expect(back.received).toEqual([MSG_WAITING, msg(2)]);
  });

  it('forgets a client’s cursor after a day away', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_750_000_000_000);
    const { r, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    r.addClient(a);
    fromClient(a, GET_NEXT);
    fromDevice(msg(1));
    r.removeClient(a);

    vi.setSystemTime(1_750_000_000_000 + DAY_MS + 1);
    const back = client('10.0.0.1', 'a-again');
    r.addClient(back);
    fromClient(back, GET_NEXT);

    // Treated as new: the cached backlog is replayed from the start.
    expect(back.received).toEqual([MSG_WAITING, msg(1)]);
  });

  // Same host, different client app: two inboxes, not one.
  it('keys cursors by IP and app name together', () => {
    const { r, forwardToDevice, fromClient, fromDevice } = router();
    const flutter = client('10.0.0.1', 'flutter');
    r.addClient(flutter);
    expect(fromClient(flutter, appStart('meshcore-flutter'))).toBe('forward');
    fromClient(flutter, GET_NEXT);
    fromDevice(msg(1));
    r.removeClient(flutter);

    // Another app on the same machine has read nothing yet.
    const other = client('10.0.0.1', 'other');
    r.addClient(other);
    fromClient(other, appStart('other-client'));
    fromClient(other, GET_NEXT);
    expect(other.received.at(-1)).toEqual(msg(1));
    r.removeClient(other);

    // The Flutter app comes back and resumes past message 1 rather than
    // inheriting the other app's position or the bare-IP binding's.
    const flutterAgain = client('10.0.0.1', 'flutter-again');
    r.addClient(flutterAgain);
    fromClient(flutterAgain, appStart('meshcore-flutter'));
    const calls = forwardToDevice.mock.calls.length;
    fromClient(flutterAgain, GET_NEXT);
    expect(flutterAgain.received).not.toContainEqual(msg(1));
    expect(forwardToDevice).toHaveBeenCalledTimes(calls + 1);
  });

  it('drops every cursor and the cache on reset', () => {
    const { r, forwardToDevice, fromClient, fromDevice } = router();
    const a = client('10.0.0.1');
    r.addClient(a);
    fromClient(a, GET_NEXT);
    fromDevice(msg(1));
    fromClient(a, GET_NEXT);
    fromDevice(NO_MORE);

    r.reset();
    fromClient(a, GET_NEXT);

    // A new BLE session: neither the old cache nor the old "drained" flag apply.
    expect(forwardToDevice).toHaveBeenCalledTimes(3);
  });
});

describe('InboxRouter: channel sends from a proxy client', () => {
  /** CMD_SEND_CHAN_TXT_MSG: [0x03][flags][chan_idx][ts u32 LE][text]. */
  function chanSend(idx: number, ts: number, text: string): Buffer {
    const head = Buffer.alloc(7);
    head[0] = CMD.SEND_CHAN_TXT_MSG;
    head[2] = idx;
    head.writeUInt32LE(ts, 3);
    return Buffer.concat([head, Buffer.from(text, 'utf8')]);
  }

  /** RESP_SELF_INFO with the node name at the end of the frame. */
  function selfInfo(name: string): Buffer {
    const header = Buffer.alloc(57);
    header[0] = RESP.SELF_INFO;
    header[56] = 0x07;
    return Buffer.concat([header, Buffer.from(name, 'ascii')]);
  }

  it('echoes the send to the other clients as a received channel message', () => {
    const { r, fromClient, fromDevice } = router();
    const sender = client('10.0.0.1');
    const other = client('10.0.0.2');
    r.addClient(sender);
    r.addClient(other);
    expect(fromDevice(selfInfo('Base Camp'))).toBe('fanout');

    // Still forwarded: the radio has to actually transmit it.
    expect(fromClient(sender, chanSend(2, 1_750_000_000, 'hello mesh'))).toBe('forward');

    expect(other.received).toEqual([MSG_WAITING]);
    fromClient(other, GET_NEXT);
    const echo = other.received[1];
    // [0x11][snr][rsv][rsv][chan_idx][path_len][txt_type][ts u32 LE][text]
    expect(echo[0]).toBe(RESP.CHANNEL_MSG_RECV_V3);
    expect(echo[4]).toBe(2);
    expect(echo.readUInt32LE(7)).toBe(1_750_000_000);
    expect(echo.subarray(11).toString('utf8')).toBe('Base Camp: hello mesh');
  });

  it('does not echo the send back to the client that made it', () => {
    const { r, forwardToDevice, fromClient } = router();
    const sender = client('10.0.0.1');
    r.addClient(sender);

    fromClient(sender, chanSend(0, 1_750_000_000, 'hi'));
    fromClient(sender, GET_NEXT);

    expect(sender.received).toEqual([]);
    expect(forwardToDevice).toHaveBeenCalledTimes(1); // a miss, so on to the device
  });
});
