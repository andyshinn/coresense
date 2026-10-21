import type { Hono } from 'hono';
import type { AdvertPathResponse, ApiErrorBody, RefreshContactsResponse } from '../../../shared/api/contract';
import {
  contactPathBodySchema,
  contactSchema,
  favouriteBodySchema,
  telemetryPermsSchema,
} from '../../../shared/api/schemas';
import { pubkeyFromKey } from '../../../shared/conversationKey';
import { emit } from '../../events/bus';
import { protocolSession } from '../../protocol';
import { fetchAdvertPath } from '../../state/advertPath';
import { refreshContacts } from '../../state/contactRefresh';
import { mirrorOutPath, scheduleDiscoveredEmit } from '../../state/contactSync';
import { stateHolder } from '../../state/holder';
import { discoveredStore } from '../../storage/discoveredContacts';
import { readJson } from '../body';
import { fail503, knownErrorResponse } from '../errors';

export function registerContactRoutes(api: Hono): void {
  api.get('/api/contacts', (c) => c.json(stateHolder().getContacts()));
  api.put('/api/contacts/:key', async (c) => {
    const key = c.req.param('key');
    const body = await readJson(c, contactSchema);
    if (body.key !== key) return c.json({ error: 'body key does not match the path', code: 'invalid_body' }, 400);
    const holder = stateHolder();
    holder.upsertContact(body);
    emit.contacts(holder.getContacts());
    return c.json({ ok: true });
  });
  api.delete('/api/contacts/:key', async (c) => {
    const key = c.req.param('key');
    const pubkey = pubkeyFromKey(key);
    // Tell the radio to drop the contact first (CMD_REMOVE_CONTACT). Strict: if
    // the radio op fails (disconnected, not on radio) we leave local state alone
    // so the app and radio can't desync — a local-only delete would just resync
    // back from the radio on the next contact sync.
    try {
      await protocolSession().removeContactFromRadio(pubkey);
    } catch (err) {
      return fail503(c, err);
    }
    const holder = stateHolder();
    holder.removeContact(key);
    emit.contacts(holder.getContacts());
    return c.json({ ok: true });
  });

  // ---- Discovered-contacts pool ---------------------------------------
  api.get('/api/discovered-contacts', (c) => {
    const holder = stateHolder();
    return c.json(discoveredStore.list(holder.getBlockRules()));
  });

  // Re-read the radio's contact store on demand (#45 item 6). Before this the
  // only way to pick up a contact the radio learned after the handshake — or to
  // repair a mirror that drifted — was to disconnect and reconnect.
  //
  // Emits nothing by hand: the walk drives the lib's contactObserved/contacts/
  // discovered/contactsSynced events, which adapterEvents already writes through
  // and broadcasts (coalesced). A manual emit here would just double-send a
  // full-pool payload.
  //
  // The guards live in state/contactRefresh.refreshContacts(), NOT here: the
  // periodic re-read calls the same function, and the in-flight flag only works
  // if every caller shares it. Two overlapping walks make the library delete
  // real contacts (see state/contactWalk.ts), so `skipped` is a correctness
  // answer, not just politeness.
  api.post('/api/contacts/refresh', async (c) => {
    const res = await refreshContacts();
    switch (res.status) {
      case 'offline':
        return c.json({ error: 'no radio attached' }, 503);
      case 'failed':
        return c.json({ error: res.message }, 503);
      case 'skipped':
        return c.json({ ok: true, skipped: true } satisfies RefreshContactsResponse);
      default:
        return c.json({ ok: true, count: res.count } satisfies RefreshContactsResponse);
    }
  });

  // Commit a discovered contact to the radio's store.
  api.post('/api/contacts/:key/add-to-radio', async (c) => {
    const key = c.req.param('key');
    const pubkey = pubkeyFromKey(key);
    try {
      await protocolSession().addContactToRadio(pubkey);
      return c.json({ ok: true });
    } catch (err) {
      return knownErrorResponse(c, err) ?? fail503(c, err);
    }
  });

  // Delete a contact from the radio's store (stays in the discovered pool).
  api.post('/api/contacts/:key/remove-from-radio', async (c) => {
    const key = c.req.param('key');
    const pubkey = pubkeyFromKey(key);
    try {
      await protocolSession().removeContactFromRadio(pubkey);
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });

  // Toggle the radio-level favourite flag.
  api.put('/api/contacts/:key/favourite', async (c) => {
    const key = c.req.param('key');
    const pubkey = pubkeyFromKey(key);
    const body = await readJson(c, favouriteBodySchema);
    try {
      await protocolSession().setContactFavourite(pubkey, body.favourite);
      return c.json({ ok: true });
    } catch (err) {
      return knownErrorResponse(c, err) ?? fail503(c, err);
    }
  });

  // Per-contact telemetry permissions on MY radio (contact flags bits 1-3),
  // consulted only for a TelemetryPolicy mode of 1 (per contact). The library
  // rewrites the whole contact record keeping the favourite bit.
  api.put('/api/contacts/:key/telemetry-perms', async (c) => {
    const pubkey = pubkeyFromKey(c.req.param('key')).toLowerCase();
    const perms = await readJson(c, telemetryPermsSchema);
    try {
      const ok = await protocolSession().setContactTelemetryPerms(`c:${pubkey}`, perms);
      if (!ok) return c.json({ error: 'radio rejected the contact update or timed out' }, 503);
    } catch (err) {
      return knownErrorResponse(c, err) ?? fail503(c, err);
    }
    // The library's `discovered` write-through only carries on_radio and
    // favourite, so mirror the new bits ourselves or the stored flags byte —
    // and every DiscoveredContact.telemetryPerms read from it — stays stale
    // until the next contact walk.
    if (discoveredStore.setTelemetryPerms(pubkey, perms)) scheduleDiscoveredEmit();
    return c.json({ ok: true });
  });

  // Measure one contact's INBOUND hop count (#45 item 7) — what the radio
  // counted on the last advert it heard from this node, which is a different
  // direction from the out_path_len-derived `hops` the app has always shown.
  //
  // A POST because it is a radio round trip with a persisted side effect, and
  // per-contact because that is the only shape the firmware supports: there is
  // no bulk form of CMD_GET_ADVERT_PATH, and a pool-wide walk would be hundreds
  // of commands for a value shown one row at a time.
  //
  // The guards (connected / on-radio / in-flight / cooldown) all live in
  // state/advertPath.fetchAdvertPath, which the advert-triggered sampler shares
  // — a guard split between the route and the sampler would guard neither.
  api.post('/api/contacts/:key/advert-path', async (c) => {
    const key = c.req.param('key');
    // `force=1` is the user pressing the button: skip the cooldown, but still
    // share an in-flight request rather than issuing a second command.
    const res = await fetchAdvertPath(key, { force: c.req.query('force') === '1' });
    switch (res.status) {
      case 'offline':
        return c.json({ error: 'no radio attached' }, 503);
      case 'notOnRadio':
        // 422, not 503: nothing is broken. The lib would have thrown resolving
        // the key through the radio's contact map, and reporting the ~60% of a
        // real pool that is discovered-only as "radio error" is a lie.
        return c.json({ error: 'contact is not on the radio', code: 'not_on_radio' } satisfies ApiErrorBody, 422);
      case 'failed':
        return c.json({ error: res.message }, 503);
      case 'notCached':
        // 200, not 404: "the radio has not heard this node lately" is the
        // expected answer for most contacts, and 404 would read as "no such
        // contact". The row is left exactly as it was. `fromCache: true` is a
        // miss served from the cooldown without asking the radio, which the
        // rail's automatic measurement must not count as the radio's answer.
        return c.json({ cached: false, fromCache: res.fromCache } satisfies AdvertPathResponse);
      case 'noPath':
        // Also 200 and also `cached: false` — `cached` answers "is there a hop
        // count", and there is not — but tagged, because this is not the miss
        // above: the radio DOES hold an entry for this node, with a reception
        // time real enough to have advanced its last-heard, and only the path
        // is the 0xFF flood sentinel. Telling the user "no recent advert path"
        // while the rail's Last heard moves under them would contradict itself.
        return c.json({ cached: false, reason: 'noPath', recvTimestampUnix: res.recvUnix } satisfies AdvertPathResponse);
      default:
        return c.json({
          cached: true,
          hops: res.hops,
          pathHex: res.pathHex,
          recvTimestampUnix: res.recvUnix,
          fromCache: res.fromCache,
        } satisfies AdvertPathResponse);
    }
  });

  // Drop discovered-only rows (keeps on-radio contacts).
  api.post('/api/discovered-contacts/clear', (c) => {
    discoveredStore.clearDiscoveredOnly();
    const holder = stateHolder();
    emit.discovered(discoveredStore.list(holder.getBlockRules()));
    return c.json({ ok: true });
  });

  // ---- Per-contact path ------------------------------------------------
  // Writes the path back to the radio (firmware is the source of truth) and
  // updates the local Contact record on success. preferDirect is a local-only
  // flag — no firmware write needed.
  api.put('/api/contacts/:key/path', async (c) => {
    const key = c.req.param('key');
    const body = await readJson(c, contactPathBodySchema);
    const outPathHex = (body.outPathHex ?? '').toLowerCase().replace(/[^0-9a-f]/g, '');
    try {
      if (typeof body.preferDirect === 'boolean') {
        protocolSession().setContactPreferDirect(key, body.preferDirect);
      }
      await protocolSession().setContactPath(key, outPathHex, {
        manual: true,
        preferDirect: body.preferDirect,
      });
      // Radio first, mirror second: the lib touches only its own contact map, so
      // without this the discovered row keeps its pre-edit out_path_len and the
      // Contact Manager's hop cell (and the rail, which prefers the discovered
      // row) lies until the next full GET_CONTACTS.
      mirrorOutPath(key, outPathHex, { emptyMeans: 'direct' });
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });

  api.delete('/api/contacts/:key/path', async (c) => {
    const key = c.req.param('key');
    try {
      await protocolSession().resetContactPath(key);
      // Back to OUT_PATH_UNKNOWN, so the hop cell reads "Flood" immediately.
      mirrorOutPath(key, '', { emptyMeans: 'unknown' });
      return c.json({ ok: true });
    } catch (err) {
      return fail503(c, err);
    }
  });
}
