// Property-style checks: telemetry payloads come off the air, so nothing in
// the shared layer may throw on arbitrary bytes, and display text must follow
// the copy rules whatever the values.
import { describe, expect, it } from 'vitest';
import { describeChannels } from '../../../../src/shared/telemetry/describe';
import { toSavedRequestDto } from '../../../../src/shared/telemetry/dto';
import { decodeLpp, LPP_TYPES } from '../../../../src/shared/telemetry/lpp';
import {
  buildCompareTable,
  compareCsv,
  type DecodedRequest,
  previousForRequest,
} from '../../../../src/shared/telemetry/previous';

// mulberry32: small seeded PRNG so a failure reproduces.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const TYPE_IDS = Object.keys(LPP_TYPES).map(Number);

// Pure noise, or well-formed records with random data (the interesting case:
// it reaches every decoder and describe branch), optionally truncated/padded.
function payload(rand: () => number): Uint8Array {
  const out: number[] = [];
  if (rand() < 0.3) {
    const n = Math.floor(rand() * 64);
    for (let i = 0; i < n; i += 1) out.push(Math.floor(rand() * 256));
  } else {
    const records = Math.floor(rand() * 12);
    for (let r = 0; r < records; r += 1) {
      const type = LPP_TYPES[TYPE_IDS[Math.floor(rand() * TYPE_IDS.length)]];
      out.push(1 + Math.floor(rand() * 5), type.id);
      for (let i = 0; i < type.len; i += 1) out.push(Math.floor(rand() * 256));
    }
    if (rand() < 0.2) out.length = Math.floor(rand() * out.length);
    if (rand() < 0.3) for (let i = Math.floor(rand() * 16); i > 0; i -= 1) out.push(0);
  }
  return Uint8Array.from(out);
}

describe('fuzzed payloads', () => {
  it('decodeLpp never throws, and readings tile the payload up to rest', () => {
    const rand = prng(0xc0ffee);
    for (let n = 0; n < 3000; n += 1) {
      const raw = payload(rand);
      const { readings, rest } = decodeLpp(raw);
      let at = 0;
      for (const r of readings) {
        expect(r.offset).toBe(at);
        expect(r.len).toBe(2 + LPP_TYPES[r.typeId].len);
        at += r.len;
      }
      // Whatever is not decoded is either rest or all-zero padding.
      if (rest.length > 0) expect(at + rest.length).toBe(raw.length);
      else expect(raw.subarray(at).every((b) => b === 0)).toBe(true);
    }
  });

  it('describe, history, compare and CSV never throw and keep the copy rules', () => {
    const rand = prng(0xbadc0de);
    for (let n = 0; n < 400; n += 1) {
      const source = rand() < 0.5 ? 'companion' : 'repeater';
      const requests: DecodedRequest[] = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => {
        const dto = toSavedRequestDto({
          id: `r${i}`,
          nodeKey: 'ab'.repeat(32),
          source,
          requestedAt: 1_000_000 + i * 60_000,
          repliedAt: null,
          outcome: rand() < 0.8 ? 'ok' : 'timeout',
          roundTripMs: null,
          hops: null,
          route: null,
          aclRole: null,
          permsGranted: null,
          raw: payload(rand),
        });
        return JSON.parse(JSON.stringify(dto));
      });
      for (const r of requests) {
        for (const g of describeChannels(r.readings, source)) {
          for (const d of g.readings) {
            for (const text of [d.text, d.secondary ?? '']) {
              expect(text).not.toMatch(/NaN|undefined|Infinity/);
              // Display values use the Unicode minus, never an ASCII sign.
              expect(text).not.toMatch(/(^|[^\w.])-\d/);
            }
          }
        }
        expect(previousForRequest(requests, r)).toHaveLength(r.readings.length);
      }
      const table = buildCompareTable(requests, { source, changesOnly: rand() < 0.5 });
      expect(compareCsv(table).split('\n')[0]).toMatch(/^reading,ch,type/);
    }
  });
});
