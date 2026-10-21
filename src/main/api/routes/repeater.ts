import type { Context, Hono } from 'hono';
import type {
  ApiErrorBody,
  RepeaterAclResponse,
  RepeaterCliResponse,
  RepeaterLoginResponse,
  RepeaterNeighboursResponse,
  RepeaterOwnerResponse,
  RepeaterSessionResponse,
  RepeaterTraceResponse,
} from '../../../shared/api/contract';
import {
  repeaterCliBodySchema,
  repeaterLoginBodySchema,
  repeaterNeighboursBodySchema,
  repeaterTraceBodySchema,
} from '../../../shared/api/schemas';
import { errorMessage } from '../../../shared/errors';
import { adminSessions } from '../../bridge/adminSession';
import { protocolSession } from '../../protocol';
import { noteHeard } from '../../state/contactSync';
import { type MeshLockOwner, radioBusyBody, withMeshLock } from '../../telemetry/meshLock';
import { readJson } from '../body';
import { fail503 } from '../errors';

/** Run an awaited admin request under the radio-wide mesh lock
 *  (telemetry/meshLock.ts): the companion firmware keeps one pending request,
 *  so a second one would silently kill the reply the first is waiting for.
 *  Resolves the 409 `radio_busy` response when the lock is held, otherwise
 *  whatever `fn` returns. */
async function underMeshLock(
  c: Context,
  owner: MeshLockOwner,
  contactKey: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const nodeKey = (contactKey.startsWith('c:') ? contactKey.slice(2) : contactKey).toLowerCase();
  const res = await withMeshLock(owner, nodeKey, fn);
  return res.busy ? c.json(radioBusyBody(res.busy), 409) : res.value;
}

export function registerRepeaterRoutes(api: Hono): void {
  // Repeater admin: request a status snapshot from a contact. Synchronous
  // response = "did the radio accept the write"; the snapshot itself arrives
  // as a separate WS push event after the mesh round-trip. Deliberately NOT
  // under the mesh lock: there is no reply to hold it across. Telemetry lives
  // in routes/telemetry.ts.
  api.post('/api/repeater/:key/status', async (c) => {
    const key = c.req.param('key');
    const result = await protocolSession().sendStatusReq(key);
    if (!result.ok) return c.json({ error: result.error }, 503);
    return c.json({ ok: true });
  });

  // Repeater admin: full session-bearing flow. Login/logout track state in the
  // adminSessions store; ACL / neighbours / owner-info / CLI awaits the mesh
  // round-trip and returns the parsed result inline (5-30s typical). Each of
  // those awaited requests holds the radio-wide mesh lock and answers 409
  // `radio_busy` while another one (telemetry included) holds it.
  api.get('/api/repeater/:key/session', (c) => {
    const key = c.req.param('key');
    return c.json({ session: adminSessions.getSession(key) } satisfies RepeaterSessionResponse);
  });

  api.post('/api/repeater/:key/login', async (c) => {
    const key = c.req.param('key');
    const body = await readJson(c, repeaterLoginBodySchema);
    return underMeshLock(c, 'login', key, async () => {
      try {
        const result = await protocolSession().repeaterLogin(key, body.password);
        return c.json({ ok: true, session: adminSessions.getSession(key), login: result } satisfies RepeaterLoginResponse);
      } catch (err) {
        return fail503(c, err);
      }
    });
  });

  api.post('/api/repeater/:key/logout', async (c) => {
    const key = c.req.param('key');
    try {
      await protocolSession().repeaterLogout(key);
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });

  api.post('/api/repeater/:key/acl', async (c) => {
    const key = c.req.param('key');
    return underMeshLock(c, 'acl', key, async () => {
      try {
        const entries = await protocolSession().repeaterRequestAcl(key);
        return c.json({ ok: true, entries } satisfies RepeaterAclResponse);
      } catch (err) {
        return fail503(c, err);
      }
    });
  });

  api.post('/api/repeater/:key/neighbours', async (c) => {
    const key = c.req.param('key');
    const body = await readJson(c, repeaterNeighboursBodySchema, { optional: true });
    return underMeshLock(c, 'neighbours', key, async () => {
      try {
        const page = await protocolSession().repeaterRequestNeighbours(key, body);
        return c.json({ ok: true, page } satisfies RepeaterNeighboursResponse);
      } catch (err) {
        return fail503(c, err);
      }
    });
  });

  api.post('/api/repeater/:key/owner', async (c) => {
    const key = c.req.param('key');
    return underMeshLock(c, 'owner', key, async () => {
      try {
        const info = await protocolSession().repeaterRequestOwnerInfo(key);
        return c.json({ ok: true, info } satisfies RepeaterOwnerResponse);
      } catch (err) {
        return fail503(c, err);
      }
    });
  });

  api.post('/api/repeater/:key/cli', async (c) => {
    const key = c.req.param('key');
    const body = await readJson(c, repeaterCliBodySchema);
    // Defaults to a reply-expecting send; only an explicit false opts out.
    const expectReply = body.expectReply !== false;
    return underMeshLock(c, 'cli', key, async () => {
      try {
        // Forward the HTTP request's own AbortSignal: if the client aborts (repeater
        // switch / unmount), the library deletes its pendingCli entry rather than
        // holding it for the full CLI_REPLY_TIMEOUT_MS (§5.1, §7.1).
        const reply = await protocolSession().repeaterSendCli(key, body.command, {
          expectReply,
          signal: c.req.raw.signal,
        });
        if (!expectReply) return c.json({ ok: true, sent: true } satisfies RepeaterCliResponse, 202);
        // The reply packet came from this repeater — the lib correlates pending
        // CLI sends by the sender's pubkey prefix, so a resolved reply is a real
        // reception from `key` and not a guess (#45 item 9).
        noteHeard(key);
        return c.json({ ok: true, reply } satisfies RepeaterCliResponse, 200);
      } catch (err) {
        // Coerce defensively: a non-Error rejection (thrown string, or an object
        // without a string `.message`) would make `.includes(...)` throw and mask
        // the real failure as an opaque 500.
        const message = errorMessage(err);
        // Classified once, here, so the renderer switches on `code` alone. The
        // library only reports these as message text: a lapsed reply rejects with
        // `CLI command timed out after <ms>ms` (§7.1), and a newer command to the
        // same repeater rejects the older one with `superseded by newer CLI
        // command` (§5.4). Anything else is a transport-tier failure.
        if (message.includes('timed out after')) {
          return c.json({ error: message, code: 'cli_timeout' } satisfies ApiErrorBody, 504);
        }
        if (message.includes('superseded by newer CLI command')) {
          return c.json({ error: message, code: 'cli_superseded' } satisfies ApiErrorBody, 503);
        }
        return c.json({ error: message, code: 'transport' } satisfies ApiErrorBody, 503);
      }
    });
  });

  api.post('/api/repeater/:key/trace', async (c) => {
    const key = c.req.param('key');
    const body = await readJson(c, repeaterTraceBodySchema);
    const params = { tag: body.tag, authCode: body.authCode ?? 0, flags: body.flags, pathHex: body.pathHex };
    // Under the mesh lock although firmware keeps trace out of the pending
    // slot: its RESP_SENT can be swapped with a telemetry request's (see
    // telemetry/meshLock.ts).
    return underMeshLock(c, 'trace', key, async () => {
      try {
        const trace = await protocolSession().repeaterTracePath(params);
        // A returned trace means the node at the end of `pathHex` turned the
        // packet around. TRACE_DATA itself carries only per-hop HASHES, so the
        // identity comes from the caller's own `:key` — the contact it asked to
        // trace. Attribution is therefore only as good as that assertion, which
        // is why it lives here rather than in the decode path (#45 item 9).
        noteHeard(key);
        return c.json({ ok: true, trace } satisfies RepeaterTraceResponse);
      } catch (err) {
        return fail503(c, err);
      }
    });
  });
}
