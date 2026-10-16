import { describe, expect, it, vi } from 'vitest';
import { transportManager } from '../../../src/main/transport/manager';
import type { ITransport } from '../../../src/main/transport/types';
import type { ApiErrorBody, OkResponse } from '../../../src/shared/api/contract';
import type { TransportState } from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';

const post = (path: string, init: RequestInit = { method: 'POST' }) => testRoutes().request(path, init);

/** Install a transport double whose connect/disconnect run `impl`. */
function fakeTransport(impl: () => Promise<void> = () => Promise.resolve()) {
  const connect = vi.fn((_deviceId: string) => impl());
  const disconnect = vi.fn(() => impl());
  transportManager.setTransport({ connect, disconnect } as unknown as ITransport);
  return { connect, disconnect };
}

describe('GET /api/transport/state', () => {
  it('reports the link state and the attached device', async () => {
    transportManager.setState('connected', 'AA:BB:CC');

    const res = await testRoutes().request('/api/transport/state');

    expect(res.status).toBe(200);
    expect((await res.json()) as { state: TransportState; deviceId?: string }).toEqual({
      state: 'connected',
      deviceId: 'AA:BB:CC',
    });
  });

  it('reports idle with no device', async () => {
    const res = await testRoutes().request('/api/transport/state');
    expect((await res.json()) as { state: TransportState; deviceId?: string }).toEqual({ state: 'idle' });
  });
});

describe('POST /api/transport/advert', () => {
  it('floods the advert by default, with no body', async () => {
    const sendSelfAdvert = vi.fn((_flood?: boolean) => Promise.resolve({ ok: true }));
    installSessionStub({ sendSelfAdvert });

    const res = await post('/api/transport/advert');

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(sendSelfAdvert).toHaveBeenCalledWith(true);
  });

  it('sends a zero-hop advert when flood is false', async () => {
    const sendSelfAdvert = vi.fn((_flood?: boolean) => Promise.resolve({ ok: true }));
    installSessionStub({ sendSelfAdvert });

    await post('/api/transport/advert', json('POST', { flood: false }));

    expect(sendSelfAdvert).toHaveBeenCalledWith(false);
  });

  it('answers 503 with the radio error when the advert fails', async () => {
    installSessionStub({ sendSelfAdvert: () => Promise.resolve({ ok: false, error: 'not connected' }) });

    const res = await post('/api/transport/advert');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'not connected' });
  });
});

describe('POST /api/transport/connect', () => {
  it('connects the active transport to the named device', async () => {
    const t = fakeTransport();

    const res = await post('/api/transport/connect', json('POST', { deviceId: 'AA:BB:CC' }));

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(t.connect).toHaveBeenCalledWith('AA:BB:CC');
  });

  it('answers 400 when no transport is installed', async () => {
    const res = await post('/api/transport/connect', json('POST', { deviceId: 'AA:BB:CC' }));

    expect(res.status).toBe(400);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'No active transport' });
  });

  it('answers 503 with the message when the connect fails', async () => {
    fakeTransport(() => Promise.reject(new Error('device not found')));

    const res = await post('/api/transport/connect', json('POST', { deviceId: 'AA:BB:CC' }));

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'device not found' });
  });
});

describe('POST /api/transport/disconnect', () => {
  it('disconnects the active transport', async () => {
    const t = fakeTransport();

    const res = await post('/api/transport/disconnect');

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(t.disconnect).toHaveBeenCalledOnce();
  });

  it('answers 400 when no transport is installed', async () => {
    const res = await post('/api/transport/disconnect');

    expect(res.status).toBe(400);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'No active transport' });
  });

  it('answers 503 with the message when the disconnect fails', async () => {
    fakeTransport(() => Promise.reject(new Error('gatt busy')));

    const res = await post('/api/transport/disconnect');

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'gatt busy' });
  });
});
