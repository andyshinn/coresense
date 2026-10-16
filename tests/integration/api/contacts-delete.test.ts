import { describe, expect, it, vi } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import type { Contact } from '../../../src/shared/types';
import { installSessionStub, testRoutes } from '../../support/api';

const contact: Contact = {
  key: 'c:deadbeef',
  publicKeyHex: 'deadbeef',
  name: '🌀 Blue Tracker',
  kind: 'chat',
};

/** Inject a SessionAdapter double exposing only removeContactFromRadio. */
function spySession(impl: (pk: string) => Promise<void>) {
  const removeContactFromRadio = vi.fn(impl);
  installSessionStub({ removeContactFromRadio });
  return removeContactFromRadio;
}

describe('DELETE /api/contacts/:key', () => {
  it('removes the contact from the radio (CMD_REMOVE_CONTACT), not just local state', async () => {
    stateHolder().setContacts([contact]);
    const remove = spySession(() => Promise.resolve());

    const res = await testRoutes().request('/api/contacts/c%3Adeadbeef', { method: 'DELETE' });

    expect(res.status).toBe(200);
    // The radio must be told to drop the contact, with the c: prefix stripped.
    expect(remove).toHaveBeenCalledWith('deadbeef');
    expect(stateHolder().getContacts()).toHaveLength(0);
  });

  it('does NOT remove locally when the radio op fails (strict)', async () => {
    stateHolder().setContacts([contact]);
    spySession(() => Promise.reject(new Error('radio disconnected')));

    const res = await testRoutes().request('/api/contacts/c%3Adeadbeef', { method: 'DELETE' });

    expect(res.status).toBe(503);
    // Contact stays put so app and radio don't desync.
    expect(stateHolder().getContacts()).toHaveLength(1);
  });
});
