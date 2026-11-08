import type { Hono } from 'hono';
import type { ApiErrorBody } from '../../../shared/api/contract';
import { normalizeNodeKey } from '../../../shared/telemetry/dto';
import { radioBusyBody } from '../../telemetry/meshLock';
import {
  clearTelemetry,
  deleteTelemetryRequest,
  getTelemetryDetail,
  listTelemetry,
  readSelfLive,
  requestTelemetry,
  saveSelfSnapshot,
} from '../../telemetry/service';
import { isUserCommandInFlight } from '../middleware/userCommandGate';

/** Saved telemetry requests (telemetry/service.ts).
 *
 *  `:nodeKey` is the bare 64-hex public key or the app's `c:<hex>` contact key
 *  (percent-encoded; Hono decodes it — never decodeURIComponent again). The
 *  owner's own key reads the companion radio. The literal `request` routes are
 *  registered first: `/api/telemetry/request/:id` has two segments and can't
 *  match `/:nodeKey` today, but a later `/:nodeKey/...` route could shadow it. */
export function registerTelemetryRoutes(api: Hono): void {
  // My Node's live reading of the companion's own telemetry: not saved. A
  // poll, so it steps aside for a user command (409 `busy_skip`).
  api.post('/api/telemetry/self/live', async (c) => {
    if (isUserCommandInFlight()) {
      return c.json({ error: 'a user command is in flight', code: 'busy_skip' } satisfies ApiErrorBody, 409);
    }
    const res = await readSelfLive();
    switch (res.status) {
      case 'ok':
        return c.json(res.read);
      case 'offline':
        return c.json({ error: 'no radio attached' }, 503);
      case 'noOwner':
        return c.json({ error: 'radio identity not known yet' }, 503);
      case 'unsupported':
        return c.json({ error: res.message, code: 'self_telemetry_unsupported' } satisfies ApiErrorBody, 501);
      default:
        return c.json({ error: res.message }, 503);
    }
  });

  // "Save snapshot": store the live read above, exactly as shown, in the same
  // saved-request history every telemetry request uses.
  api.post('/api/telemetry/self/snapshot', (c) => {
    const res = saveSelfSnapshot();
    switch (res.status) {
      case 'saved':
        return c.json(res.request);
      case 'stale':
        return c.json(
          {
            error: `the last reading is ${Math.round(res.ageMs / 1000)} s old`,
            code: 'stale_live_read',
          } satisfies ApiErrorBody,
          409,
        );
      default:
        return c.json(
          { error: 'no reading from the connected radio yet', code: 'no_live_read' } satisfies ApiErrorBody,
          409,
        );
    }
  });

  api.get('/api/telemetry/request/:id', (c) => {
    const detail = getTelemetryDetail(c.req.param('id'));
    if (!detail) return c.json({ error: 'not found' }, 404);
    return c.json(detail);
  });

  api.delete('/api/telemetry/request/:id', (c) => {
    if (!deleteTelemetryRequest(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  // Resolves when the request has finished: 200 with the saved request even
  // for a timeout or error outcome, because it ran and was saved. Failures
  // before anything was sent are not saved and get their own status. A second
  // POST for the same node while one is pending joins it.
  api.post('/api/telemetry/:nodeKey/request', async (c) => {
    const nodeKey = normalizeNodeKey(c.req.param('nodeKey'));
    if (!nodeKey) return c.json({ error: 'nodeKey must be a 64-hex public key or c:<hex>' }, 400);
    const res = await requestTelemetry(nodeKey);
    switch (res.status) {
      case 'saved':
        return c.json(res.request);
      case 'offline':
        return c.json({ error: 'no radio attached' }, 503);
      case 'notOnRadio':
        return c.json({ error: 'contact is not on the radio', code: 'not_on_radio' } satisfies ApiErrorBody, 422);
      case 'busy':
        return c.json(radioBusyBody(res.holder), 409);
      default:
        return c.json({ error: res.message }, 503);
    }
  });

  api.get('/api/telemetry/:nodeKey', (c) => {
    const nodeKey = normalizeNodeKey(c.req.param('nodeKey'));
    if (!nodeKey) return c.json({ error: 'nodeKey must be a 64-hex public key or c:<hex>' }, 400);
    return c.json(listTelemetry(nodeKey));
  });

  api.delete('/api/telemetry/:nodeKey', (c) => {
    const nodeKey = normalizeNodeKey(c.req.param('nodeKey'));
    if (!nodeKey) return c.json({ error: 'nodeKey must be a 64-hex public key or c:<hex>' }, 400);
    clearTelemetry(nodeKey);
    return c.json({ ok: true });
  });
}
