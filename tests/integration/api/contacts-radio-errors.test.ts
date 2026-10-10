import { Errors } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { installSessionStub, json, testRoutes } from '../../support/api';

/** Inject a SessionAdapter double whose radio ops all reject with `err`, the
 *  way the library's own contact commands do (SessionAdapter passes them through). */
function rejectingSession(err: unknown) {
  const reject = () => Promise.reject(err);
  installSessionStub({ addContactToRadio: reject, setContactFavourite: reject });
}

// Regression: routes used to test against coresense's own copies of these
// classes, which the library never throws, so both mapped to a blanket 503.
describe('contact radio routes map the library error classes', () => {
  it('add-to-radio answers 409 CONTACT_TABLE_FULL for ContactTableFullError', async () => {
    rejectingSession(new Errors.ContactTableFullError());
    const res = await testRoutes().request('/api/contacts/c%3Adeadbeef/add-to-radio', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe('CONTACT_TABLE_FULL');
    expect(body.error).toBe(new Errors.ContactTableFullError().message);
  });

  it('add-to-radio answers 422 for UnknownContactError', async () => {
    rejectingSession(new Errors.UnknownContactError('deadbeef'));
    const res = await testRoutes().request('/api/contacts/c%3Adeadbeef/add-to-radio', { method: 'POST' });
    expect(res.status).toBe(422);
  });

  it('favourite answers 422 for UnknownContactError', async () => {
    rejectingSession(new Errors.UnknownContactError('deadbeef'));
    const res = await testRoutes().request('/api/contacts/c%3Adeadbeef/favourite', json('PUT', { favourite: true }));
    expect(res.status).toBe(422);
  });

  it('still answers 503 for any other radio failure', async () => {
    rejectingSession(new Error('radio disconnected'));
    const res = await testRoutes().request('/api/contacts/c%3Adeadbeef/add-to-radio', { method: 'POST' });
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toEqual({ error: 'radio disconnected' });
  });
});
