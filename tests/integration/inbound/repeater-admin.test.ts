import { Buffer } from 'node:buffer';
import { Protocol } from '@andyshinn/meshcore-ts';
import { afterEach, describe, expect, it } from 'vitest';
import { adminSessions } from '../../../src/main/bridge/adminSession';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import type { Contact } from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';
import {
  binaryResponse,
  contactMsgV3,
  localStatsCore,
  loginSuccess,
  loginSuccessV6,
  repeaterStats,
  respSent,
  statusResponse,
  telemetryResponse,
} from '../../support/companionFrames';
import { makeTestSession } from '../../support/session-harness';

const PK = 'aa'.repeat(32);
const PREFIX = 'aaaaaaaaaaaa'; // first 6 bytes of PK
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Install a SessionAdapter double whose only live method is repeaterSendCli. */
function installCliStub(impl: SessionAdapter['repeaterSendCli']): void {
  installSessionStub({ repeaterSendCli: impl });
}

async function postCli(body: unknown) {
  return testRoutes().request(`/api/repeater/c%3A${PK}/cli`, json('POST', body));
}

const repeater = (): Contact => ({
  key: `c:${PK}`,
  publicKeyHex: PK,
  name: 'Repeater-1',
  kind: 'repeater',
});

// Anon OWNER response body after the tag: [now u32 LE][node_name "\n" owner\0].
function ownerAnonBody(now: number, name: string, owner: string): Buffer {
  const text = Buffer.from(`${name}\n${owner}\0`, 'utf8');
  const body = Buffer.alloc(4 + text.length);
  body.writeUInt32LE(now >>> 0, 0);
  text.copy(body, 4);
  return body;
}
// ACL list body (inside PUSH_BINARY_RESPONSE, after the 4B tag): repeating
// 7-byte [6B pubkey prefix][1B permissions] entries, one per companion. A
// distinct prefix per entry keeps the all-zero-prefix padding filter from
// dropping them.
function aclPayload(perms: number[]): Buffer {
  const body = Buffer.alloc(perms.length * 7);
  perms.forEach((p, i) => {
    body.fill(i + 1, i * 7, i * 7 + 6);
    body[i * 7 + 6] = p;
  });
  return body;
}
// A repeater CLI reply: RESP_CONTACT_MSG_RECV_V3 with txt_type CLI_DATA.
function cliReply(prefixHex: string, body: string): Buffer {
  return contactMsgV3(prefixHex, 1_700_000_000, body, { txtType: Protocol.TXT_TYPE.CLI_DATA });
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
    adminSessions.clearSession(`c:${PK}`);
  });

  it('logs in (mesh mode) and records the admin session on PUSH_LOGIN_SUCCESS', async () => {
    const { adapter, transport, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterLogin(`c:${PK}`, 'pw');
    expect(transport.sent[0][0]).toBe(Protocol.CMD.SEND_LOGIN); // the radio floods it on a flood contact
    receive(loginSuccess(PREFIX));
    const result = await p;

    expect(result.isAdmin).toBe(true);
    expect(result.mode).toBe('remote');
    expect(result.effective).toBe('flood');
    expect(adminSessions.getSession(`c:${PK}`)?.role).toBe('admin');
    // No ACL byte on the short form, so there is no role to decode.
    expect(adminSessions.getSession(`c:${PK}`)?.aclRole).toBeNull();
  });

  it('decodes the login ACL byte into a role on the admin session', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterLogin(`c:${PK}`, 'pw');
    receive(loginSuccessV6(PREFIX, 0x02)); // PERM_ACL_READ_WRITE
    await p;

    const session = adminSessions.getSession(`c:${PK}`);
    expect(session?.aclPermissionsBits).toBe(0x02);
    // The renderer can't import meshcore-ts, so if main doesn't decode this
    // nobody can: read-write is a role neither isAdmin nor isGuest expresses.
    expect(session?.aclRole).toBe('readWrite');
    expect(session?.role).toBe('guest'); // byte 1 is the plain isAdmin boolean
  });

  it('round-trips owner-info via the public anon OWNER request (RESP_SENT → BINARY_RESPONSE)', async () => {
    const { adapter, receive, sentWithCode } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const p = adapter.repeaterRequestOwnerInfo(`c:${PK}`);
    await tick();
    // Owner info now goes out as a PUBLIC anon request (CMD_SEND_ANON_REQ),
    // not the login-gated binary req (a flood contact first gets a transient
    // zero-hop path so the request routes direct).
    expect(sentWithCode(Protocol.CMD.SEND_ANON_REQ)).not.toHaveLength(0);
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

    const events = captureBus('repeaterStatus');
    await adapter.sendStatusReq(`c:${PK}`);
    receive(statusResponse(PREFIX));
    expect(events.last()?.contactKey).toBe(`c:${PK}`);

    // coresense declares no field schema — StatusTab renders whatever the
    // library decodes — so this is the only place the wire layout is pinned.
    const fields = new Map(events.last()?.fields.map((f) => [f.name, f.value]));
    expect(fields.get('Battery')).toBe(4.02);
    expect(fields.get('TX queue')).toBe(3);
    expect(fields.get('Noise floor')).toBe(-108);
    expect(fields.get('Last RSSI')).toBe(-92);
    expect(fields.get('RX packets')).toBe(18432);
    expect(fields.get('TX packets')).toBe(9211);
    expect(fields.get('TX airtime')).toBe(4321);
    expect(fields.get('Uptime')).toBe('5d 0h 0m');
    expect(fields.get('Error events')).toBe(2);
    expect(fields.get('Last SNR')).toBe(7);
    expect(fields.get('Direct dups')).toBe(310);
    expect(fields.get('Flood dups')).toBe(1400);
    expect(fields.get('RX airtime')).toBe(88_000);
    expect(fields.get('RX errors')).toBe(17);
    // There is no such member in `struct RepeaterStats`; the row that used to
    // carry this label was printing n_packets_recv.
    expect(fields.has('Free queue')).toBe(false);
  });

  it('degrades a legacy (pre-v1.12.0) 52-byte status blob instead of dropping it', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const events = captureBus('repeaterStatus');
    await adapter.sendStatusReq(`c:${PK}`);
    receive(statusResponse(PREFIX, repeaterStats().subarray(0, 52)));

    const names = events.last()?.fields.map((f) => f.name) ?? [];
    expect(names).toContain('RX airtime');
    expect(names).not.toContain('RX errors'); // the member that firmware lacks
    // The raw payload is always carried, so the UI can fall back to hex.
    expect(events.last()?.payloadHex).toHaveLength(104);
  });

  it('surfaces the decoded ACL role for every entry, not just admin/guest', async () => {
    const { adapter, receive, sentWithCode } = makeTestSession();
    adapter.session.state.upsertContact(repeater());
    adminSessions.setSession({
      contactKey: `c:${PK}`,
      publicKeyHex: PK,
      mode: 'remote',
      role: 'admin',
      permissionsBits: 1,
      aclPermissionsBits: 3,
      aclRole: 'admin',
      firmwareVerLevel: 1,
      loggedInAt: Date.now(),
    });

    const p = adapter.repeaterRequestAcl(`c:${PK}`);
    await tick();
    expect(sentWithCode(Protocol.CMD.SEND_BINARY_REQ)).not.toHaveLength(0);
    receive(respSent('feedface'));
    await tick();
    receive(binaryResponse('feedface', aclPayload([1, 2, 3, 0x80])));
    const entries = await p;

    // The low 2 bits are a role VALUE, so read-only(1) and read-write(2) are
    // roles in their own right — isAdmin/isGuest cannot express them.
    expect(entries.map((e) => e.role)).toEqual(['readOnly', 'readWrite', 'admin', 'guest']);
    expect(entries.map((e) => e.permissions)).toEqual([1, 2, 3, 0x80]);
  });

  it('emits repeaterTelemetry on PUSH_TELEMETRY_RESPONSE for a known sender', async () => {
    const { adapter, receive } = makeTestSession();
    adapter.session.state.upsertContact(repeater());

    const events = captureBus('repeaterTelemetry');
    await adapter.sendTelemetryReq(`c:${PK}`);
    receive(telemetryResponse(PREFIX));
    expect(events.last()?.contactKey).toBe(`c:${PK}`);
    expect(events.last()?.fields.length).toBeGreaterThan(0);
  });

  it('resolves local stats from RESP_STATS', async () => {
    const { adapter, receive } = makeTestSession();

    const p = adapter.repeaterGetLocalStats('CORE');
    receive(localStatsCore({ battMv: 3700, uptimeSecs: 123, queueLen: 1 }));
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
  it('returns 200 { reply } when a reply is expected and arrives', async () => {
    installCliStub(async () => 'radio: 869.525');
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, reply: 'radio: 869.525' });
  });

  it('returns 202 { sent: true } for a no-reply command', async () => {
    const calls: Array<{ expectReply?: boolean }> = [];
    installCliStub(async (_key, _command, opts) => {
      calls.push({ expectReply: opts?.expectReply });
      return '';
    });
    const res = await postCli({ command: 'set advert.interval 30', expectReply: false });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, sent: true });
    expect(calls[0].expectReply).toBe(false);
  });

  it('classifies a reply timeout as 504 cli_timeout', async () => {
    installCliStub(async () => {
      throw new Error('CLI command timed out after 30000ms');
    });
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(504);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'cli_timeout' });
  });

  it('classifies a superseded command as 503 cli_superseded', async () => {
    installCliStub(async () => {
      throw new Error('superseded by newer CLI command');
    });
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { code: string; error: string }).toMatchObject({
      code: 'cli_superseded',
      error: 'superseded by newer CLI command',
    });
  });

  it('classifies any other failure as 503 transport', async () => {
    installCliStub(async () => {
      throw new Error('link lost');
    });
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { code: string; error: string }).toMatchObject({ code: 'transport', error: 'link lost' });
  });

  it('coerces a non-Error rejection to 503 transport instead of crashing on .message', async () => {
    // A rejection that is not an Error (here a bare string) must not make the
    // classifier throw on `.includes` and surface as an opaque 500.
    installCliStub(async () => {
      throw 'raw string failure';
    });
    const res = await postCli({ command: 'get radio' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { code: string; error: string }).toMatchObject({
      code: 'transport',
      error: 'raw string failure',
    });
  });
});
