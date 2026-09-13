import { PayloadType, RouteType } from '@michaelhart/meshcore-decoder';
import { describe, expect, it } from 'vitest';
import { inspectPacket } from '../../../../src/renderer/lib/packetInspect';
import { originHop, packetHeardVia, parseOnAirRoute } from '../../../../src/renderer/lib/packetPath';
import type { LivePacket } from '../../../../src/renderer/lib/store';
import type { Contact, MessageHop } from '../../../../src/shared/types';
import { ADVERT_HEX, GROUP_TEXT_HEX, TEXT_MESSAGE_HEX } from '../../../support/packetFixtures';

// GROUP_TEXT_HEX is header 15 · pathlen 01 · path 78 · payload 2abbcc00112233.
const GT_PAYLOAD = '2abbcc00112233';

const pkt = (id: string, payloadHex: string, over: Partial<LivePacket> = {}): LivePacket => ({
  id,
  timestamp: 0,
  transportType: 'ble',
  kind: 'mesh',
  hex: '88',
  bytes: [],
  payloadHex,
  payloadBytes: [],
  snr: 5,
  rssi: -80,
  ...over,
});

const contact = (publicKeyHex: string, name: string, kind: Contact['kind'] = 'chat'): Contact => ({
  key: `c:${publicKeyHex}`,
  publicKeyHex,
  name,
  kind,
});

const ORIGIN: MessageHop = { kind: 'origin', shortId: '??', name: null, pk: null, unnamed: true };
const ends = { origin: ORIGIN, ownerName: 'Base' };

describe('parseOnAirRoute', () => {
  it('splits a flood packet at its 1-byte path', () => {
    expect(parseOnAirRoute(GROUP_TEXT_HEX)).toEqual({
      routeType: RouteType.Flood,
      payloadType: PayloadType.GroupText,
      hashSize: 1,
      pathHex: '78',
      payloadHex: GT_PAYLOAD,
    });
  });

  it('reads the hash size from the top two bits of the path-length byte', () => {
    // 0x42: hashSize 2, 2 hops → 4 path bytes.
    expect(parseOnAirRoute(`1542aaaabbbb${GT_PAYLOAD}`)).toMatchObject({
      hashSize: 2,
      pathHex: 'aaaabbbb',
      payloadHex: GT_PAYLOAD,
    });
  });

  it('skips the four transport-code bytes on transport routes', () => {
    // Header 0x14: GroupText over TransportFlood (route type 0).
    expect(parseOnAirRoute(`1411223344017a${GT_PAYLOAD}`)).toMatchObject({
      routeType: RouteType.TransportFlood,
      pathHex: '7a',
      payloadHex: GT_PAYLOAD,
    });
  });

  it('returns null for a path that runs past the end, or the reserved hash size', () => {
    expect(parseOnAirRoute('1503aabb')).toBeNull();
    expect(parseOnAirRoute(`15c1aa${GT_PAYLOAD}`)).toBeNull();
    expect(parseOnAirRoute('15')).toBeNull();
  });
});

describe('packetHeardVia', () => {
  it('builds origin → hops → our radio for a single flood reception', () => {
    const p = pkt('a', GROUP_TEXT_HEX);
    const heard = packetHeardVia(p, [p], ends);
    expect(heard?.timesHeard).toBe(1);
    expect(heard?.paths).toHaveLength(1);
    expect(heard?.paths[0]).toMatchObject({ id: '1:78', hashMode: 1, finalSnr: 5 });
    expect(heard?.paths[0].hops.map((h) => [h.kind, h.shortId])).toEqual([
      ['origin', '??'],
      ['hop', '78'],
      ['sink', 'ba'],
    ]);
    expect(heard?.selectedPathId).toBe('1:78');
  });

  it('gathers every reception of the same packet, one path per distinct route', () => {
    const viaOne = pkt('a', GROUP_TEXT_HEX, { snr: 4 });
    const viaTwo = pkt('b', `15027811${GT_PAYLOAD}`, { snr: -3 });
    const viaOneAgain = pkt('c', GROUP_TEXT_HEX, { snr: 9 });
    const other = pkt('d', '1501782abbcc00112299');
    const heard = packetHeardVia(viaOneAgain, [viaOne, other, viaTwo, viaOneAgain], ends);
    expect(heard?.timesHeard).toBe(3);
    expect(heard?.paths.map((p) => p.id)).toEqual(['1:78', '1:7811']);
    // The route heard twice shows the selected reception's SNR, not the first one's.
    expect(heard?.paths.map((p) => p.finalSnr)).toEqual([9, -3]);
    expect(heard?.selectedPathId).toBe('1:78');
  });

  it('ignores a different packet whose bytes happen to end the same way', () => {
    // Same trailing bytes, but an Advert, not a GroupText.
    const p = pkt('a', GROUP_TEXT_HEX);
    const lookalike = pkt('b', `1100${GT_PAYLOAD}`);
    expect(packetHeardVia(p, [p, lookalike], ends)?.timesHeard).toBe(1);
  });

  it('has no heard-via path for a direct packet, whose path is the route still ahead', () => {
    const p = pkt('a', TEXT_MESSAGE_HEX);
    expect(packetHeardVia(p, [p], ends)).toBeNull();
  });

  it('has no heard-via path for a trace packet, which reuses the path for SNR', () => {
    // Header 0x25: Trace (payload type 9) over Flood.
    const p = pkt('a', '2501aa00112233');
    expect(packetHeardVia(p, [p], ends)).toBeNull();
  });

  it('has none for companion frames', () => {
    const p = pkt('a', GROUP_TEXT_HEX, { kind: 'companion', codeName: 'PUSH_ADVERT' });
    expect(packetHeardVia(p, [p], ends)).toBeNull();
  });

  it('shows a 0-hop flood packet as heard straight from its sender', () => {
    const p = pkt('a', ADVERT_HEX);
    const heard = packetHeardVia(p, [p], { origin: ORIGIN, ownerName: null });
    expect(heard?.paths[0].hops.map((h) => h.kind)).toEqual(['origin', 'sink']);
    expect(heard?.paths[0].hops[1]).toMatchObject({ shortId: 'me', name: 'My radio' });
  });
});

describe('originHop', () => {
  it("names an advert's sender from the advert itself", () => {
    const hop = originHop(inspectPacket(ADVERT_HEX).sender, []);
    expect(hop).toMatchObject({ kind: 'origin', name: 'TestNode', shortId: 'te', unnamed: false });
    expect(hop.pk).toMatch(/^000102/);
  });

  it('resolves a source hash to a contact only when exactly one contact matches', () => {
    // TEXT_MESSAGE_HEX's source hash is e3.
    const sender = inspectPacket(TEXT_MESSAGE_HEX).sender;
    expect(sender).toEqual({ name: null, publicKeyHex: null, hashHex: 'e3' });
    expect(originHop(sender, [contact('e3aa', 'Alice'), contact('ffbb', 'Bob')])).toMatchObject({
      name: 'Alice',
      pk: 'e3aa',
      unnamed: false,
    });
    expect(originHop(sender, [contact('e3aa', 'Alice'), contact('e3bb', 'Eve')])).toMatchObject({
      shortId: 'e3',
      name: null,
      unnamed: true,
    });
  });

  it('is an unnamed placeholder when the payload names no sender', () => {
    // An undecrypted channel post.
    expect(originHop(inspectPacket(GROUP_TEXT_HEX).sender, [])).toEqual(ORIGIN);
  });
});
