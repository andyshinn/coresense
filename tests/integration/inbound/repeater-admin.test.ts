import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { adminSessions } from '../../../src/main/bridge/adminSession';
import { bus } from '../../../src/main/events/bus';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import type { Contact } from '../../../src/shared/types';
import { makeTestSession } from '../../support/session-harness';

const PK = 'aa'.repeat(32);
const PREFIX = 'aaaaaaaaaaaa'; // first 6 bytes of PK
const tick = () => new Promise((r) => setTimeout(r, 0));

function routesApp() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

/** A SessionAdapter double whose only live method is repeaterSendCli. */
function fakeCliAdapter(impl: SessionAdapter['repeaterSendCli']): SessionAdapter {
  return { repeaterSendCli: impl } as unknown as SessionAdapter;
}

async function postCli(body: unknown) {
  return routesApp().request(`/api/repeater/c%3A${PK}/cli`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const repeater = (): Contact => ({
  key: `c:${PK}`,
  publicKeyHex: PK,
  name: 'Repeater-1',
  kind: 'repeater',
});

// PUSH_LOGIN_SUCCESS short form: [0x85][perms][6B prefix].
function loginSuccess(prefixHex: string, perms = 1): Buffer {
  const f = Buffer.alloc(8);
  f[0] = 0x85;
  f[1] = perms;
  Buffer.from(prefixHex, 'hex').copy(f, 2);
  return f;
}
// RESP_SENT: [0x06][flood][expected_ack u32 LE][est u32 LE].
function respSent(tagHex: string): Buffer {
  const f = Buffer.alloc(10);
  f[0] = 0x06;
  f[1] = 1;
  Buffer.from(tagHex, 'hex').copy(f, 2);
  f.writeUInt32LE(5000, 6);
  return f;
}
// PUSH_BINARY_RESPONSE: [0x8c][0][tag u32][payload].
function binaryResponse(tagHex: string, body: Buffer | string): Buffer {
  const b = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  return Buffer.concat([Buffer.from([0x8c, 0x00]), Buffer.from(tagHex, 'hex'), b]);
}
// Anon OWNER response body after the tag: [now u32 LE][node_name "\n" owner\0].
function ownerAnonBody(now: number, name: string, owner: string): Buffer {
  const text = Buffer.from(`${name}\n${owner}\0`, 'utf8');
  const body = Buffer.alloc(4 + text.length);
  body.writeUInt32LE(now >>> 0, 0);
  text.copy(body, 4);
  return body;
}
// PUSH_STATUS_RESPONSE: [0x87][0][6B prefix][stats…].
function statusResponse(prefixHex: string): Buffer {
  const stats = Buffer.alloc(8);
  stats.writeUInt32LE(4020, 0); // battery 4.02 V
  stats.writeUInt32LE(2, 4); // tx queue 2
  return Buffer.concat([Buffer.from([0x87, 0x00]), Buffer.from(prefixHex, 'hex'), stats]);
}
// PUSH_TELEMETRY_RESPONSE: [0x8b][0][6B prefix][CayenneLPP].
function telemetryResponse(prefixHex: string): Buffer {
  const lpp = Buffer.from([0x00, 0x74, 0x01, 0xa4]); // ch0 voltage 4.20 V
  return Buffer.concat([Buffer.from([0x8b, 0x00]), Buffer.from(prefixHex, 'hex'), lpp]);
}
// RESP_STATS core: [0x18][subtype 0][battMv u16][uptime u32][errFlags u16][queueLen u8].
function localStatsCore(): Buffer {
  const f = Buffer.alloc(11);
  f[0] = 0x18;
  f[1] = 0x00;
  f.writeUInt16LE(3700, 2); // batt mV
  f.writeUInt32LE(123, 4); // uptime
  f.writeUInt16LE(0, 8); // err flags
  f.writeUInt8(1, 10); // queue len
  return f;
}
// RESP_CONTACT_MSG_RECV_V3 with txt_type=CLI_DATA(1) — a CLI reply.
function cliReply(prefixHex: string, body: string): Buffer {
  const text = Buffer.from(body, 'utf8');
  const f = Buffer.alloc(16 + text.length);
  f[0] = 0x10;
  f.writeInt8(40, 1);
  Buffer.from(prefixHex, 'hex').copy(f, 4);
  f[10] = 0xff;
  f[11] = 1; // CLI_DATA
  f.writeUInt32LE(1_700_000_000, 12);
  text.copy(f, 16);
  return f;
}

// White-box reach into the library's admin-correlation map. This is a
// deliberate assertion that abort/no-reply touch the RIGHT internal state
// (§11: "cleared, not merely that the client saw an abort"). `ctx` is private
// on MeshCoreSession; the cast pins the runtime shape recorded in the release
// (`ctx.rt.adminCorr.pendingCli`, keyed by the 12-char pubkey prefix). If the
// release relocates the map, update this one helper.
function pendingCliMap(adapter: SessionAdapter): Map<string, unknown> {
  return (adapter.session as unknown as { ctx: { rt: { adminCorr: { pendingCli: Map<string, unknown> } } } }).ctx.rt
    .adminCorr.pendingCli;
}

describe('repeater administration', () => {
  afterEach(() => {
    adminSessions.reset('test cleanup');
  });

  it('logs in (mesh mode) and records the admin session on PUSH_LOGIN_SUCCESS', async () => {
    const { adapter, transport, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterLogin(`c:${PK}`, 'pw');
    expect(transport.sent[0][0]).toBe(0x1a); // CMD_SEND_LOGIN — radio floods it on a flood contact
    receive(loginSuccess(PREFIX));
    const result = await p;

    expect(result.isAdmin).toBe(true);
    expect(result.mode).toBe('remote');
    expect(result.effective).toBe('flood');
    expect(adminSessions.getSession(`c:${PK}`)?.role).toBe('admin');
  });

  it('round-trips owner-info via the public anon OWNER request (RESP_SENT → BINARY_RESPONSE)', async () => {
    const { adapter, transport, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterRequestOwnerInfo(`c:${PK}`);
    await tick();
    // Owner info now goes out as a PUBLIC anon request (CMD_SEND_ANON_REQ = 0x39),
    // not the login-gated binary req (a flood contact first gets a transient
    // zero-hop path so the request routes direct).
    expect(transport.sent.some((f) => f[0] === 0x39)).toBe(true);
    // RESP_SENT hands back the tag — consumed by the admin queue (onSentTag),
    // NOT the DM FIFO.
    receive(respSent('deadbeef'));
    await tick();
    // The tagged anon OWNER response ([now u32][name\nowner]) wakes the awaiter.
    receive(binaryResponse('deadbeef', ownerAnonBody(1_700_000_000, 'Node A', 'owner notes')));
    const owner = await p;

    // Anon OWNER carries no firmware version — it maps to an empty string.
    expect(owner).toEqual({
      firmwareVersion: '',
      nodeName: 'Node A',
      ownerInfo: 'owner notes',
    });
  });

  it('emits repeaterStatus on PUSH_STATUS_RESPONSE for a known sender', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const events: Array<{ contactKey: string }> = [];
    const on = (s: { contactKey: string }) => events.push(s);
    bus.on('repeaterStatus', on);
    try {
      await adapter.sendStatusReq(`c:${PK}`);
      receive(statusResponse(PREFIX));
      expect(events.at(-1)?.contactKey).toBe(`c:${PK}`);
    } finally {
      bus.off('repeaterStatus', on);
    }
  });

  it('emits repeaterTelemetry on PUSH_TELEMETRY_RESPONSE for a known sender', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const events: Array<{ contactKey: string; fields: unknown[] }> = [];
    const on = (s: { contactKey: string; fields: unknown[] }) => events.push(s);
    bus.on('repeaterTelemetry', on);
    try {
      await adapter.sendTelemetryReq(`c:${PK}`);
      receive(telemetryResponse(PREFIX));
      expect(events.at(-1)?.contactKey).toBe(`c:${PK}`);
      expect(events.at(-1)?.fields.length).toBeGreaterThan(0);
    } finally {
      bus.off('repeaterTelemetry', on);
    }
  });

  it('resolves local stats from RESP_STATS', async () => {
    const { adapter, receive } = makeTestSession();

    const p = adapter.repeaterGetLocalStats('CORE');
    receive(localStatsCore());
    const stats = await p;
    expect(stats).toMatchObject({ kind: 'core', battMv: 3700, uptimeSecs: 123, queueLen: 1 });
  });

  it('resolves a CLI command reply routed by sender prefix', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterSendCli(`c:${PK}`, 'reboot now');
    await tick();
    receive(cliReply(PREFIX, 'OK rebooting'));
    const reply = await p;
    expect(reply).toBe('OK rebooting');
  });

  it('registers a pendingCli entry while a reply is expected', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterSendCli(`c:${PK}`, 'get radio');
    await tick();
    expect(pendingCliMap(adapter).size).toBe(1);

    receive(cliReply(PREFIX, 'radio: 869.525,250,11,5'));
    expect(await p).toBe('radio: 869.525,250,11,5');
    expect(pendingCliMap(adapter).size).toBe(0);
  });

  it('resolves a no-reply send without registering a pendingCli entry', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterSendCli(`c:${PK}`, 'set advert.interval 30', { expectReply: false });
    await tick();
    // No cliReply frame is delivered; the send resolves on transport hand-off,
    // i.e. the local radio's RESP_SENT confirmation that it queued the frame
    // for TX (dist/index.js `handleSent` → `emitSendState(..., "sent")`).
    // The loopback transport never synthesizes that frame on its own, so it
    // has to be injected here, same as every other test in this file.
    receive(respSent('deadbeef'));
    expect(await p).toBe('');
    expect(pendingCliMap(adapter).size).toBe(0);
  });

  it('clears the pendingCli entry when the caller aborts mid-flight', async () => {
    const { adapter } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const ctrl = new AbortController();
    const p = adapter.repeaterSendCli(`c:${PK}`, 'get radio', { signal: ctrl.signal });
    await tick();
    expect(pendingCliMap(adapter).size).toBe(1);

    ctrl.abort();
    await expect(p).rejects.toThrow();
    // The entry is deleted, not left to fire its 30 s timer — the whole point.
    expect(pendingCliMap(adapter).size).toBe(0);
  });
});

describe('POST /api/repeater/:key/cli classification', () => {
  afterEach(() => setProtocolSession(null));

  it('returns 200 { reply } when a reply is expected and arrives', async () => {
    setProtocolSession(fakeCliAdapter(async () => 'radio: 869.525'));
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reply: 'radio: 869.525' });
  });

  it('returns 202 { sent: true } for a no-reply command', async () => {
    const calls: Array<{ expectReply?: boolean }> = [];
    setProtocolSession(
      fakeCliAdapter(async (_key, _command, opts) => {
        calls.push({ expectReply: opts?.expectReply });
        return '';
      }),
    );
    const res = await postCli({ command: 'set advert.interval 30', expectReply: false });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, sent: true });
    expect(calls[0].expectReply).toBe(false);
  });

  it('classifies a reply timeout as 504 cli_timeout', async () => {
    setProtocolSession(
      fakeCliAdapter(async () => {
        throw new Error('CLI command timed out after 30000ms');
      }),
    );
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(504);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'cli_timeout' });
  });

  it('classifies any other failure (incl. superseded) as 503 transport', async () => {
    setProtocolSession(
      fakeCliAdapter(async () => {
        throw new Error('superseded by newer CLI command');
      }),
    );
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { code: string; error: string }).toMatchObject({
      code: 'transport',
      error: 'superseded by newer CLI command',
    });
  });

  it('coerces a non-Error rejection to 503 transport instead of crashing on .message', async () => {
    // A rejection that is not an Error (here a bare string) must not make the
    // classifier throw on `.includes` and surface as an opaque 500.
    setProtocolSession(
      fakeCliAdapter(async () => {
        throw 'raw string failure';
      }),
    );
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { code: string; error: string }).toMatchObject({
      code: 'transport',
      error: 'raw string failure',
    });
  });
});
