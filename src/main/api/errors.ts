import { Errors } from '@andyshinn/meshcore-ts';
import type { Context, ErrorHandler } from 'hono';
import { errorMessage } from '../../shared/errors';
import { child } from '../log';
import { MacroValidationError } from '../macros/store';

const log = child('api');

/** A radio or transport failure: the request was fine, the device side was
 *  not. Coerces any rejection value, so a thrown string or plain object can't
 *  turn the 503 into an opaque 500. */
export function fail503(c: Context, err: unknown) {
  return c.json({ error: errorMessage(err) }, 503);
}

/** The response for a domain error whose meaning is known, or null for
 *  anything else. Shared by the routes that catch locally and by onError, so a
 *  handler may simply let these propagate. */
export function knownErrorResponse(c: Context, err: unknown) {
  // 422, not 503: the request is well-formed but names a contact the radio
  // can't act on.
  if (err instanceof Errors.UnknownContactError) return c.json({ error: err.message }, 422);
  // The radio's contact store is full (overwrite-oldest off, or every slot is a
  // favourite). The message is user-facing.
  if (err instanceof Errors.ContactTableFullError) {
    return c.json({ error: err.message, code: 'CONTACT_TABLE_FULL' }, 409);
  }
  if (err instanceof MacroValidationError) return c.json({ error: 'invalid template', errors: err.errors }, 400);
  return null;
}

/** Last-resort handler for anything a route throws. Always answers JSON, so
 *  the renderer's request() can read the message, and logs the failure. */
export const onApiError: ErrorHandler = (err, c) => {
  const known = knownErrorResponse(c, err);
  if (known) return known;
  // Keep Hono's own contract for HTTPException (and anything shaped like it).
  if ('getResponse' in err) return err.getResponse();
  log.error(`${c.req.method} ${c.req.path} failed: ${errorMessage(err)}`, err);
  return c.json({ error: errorMessage(err), code: 'internal' }, 500);
};
