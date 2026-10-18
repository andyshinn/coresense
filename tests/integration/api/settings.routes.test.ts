import { describe, expect, it, vi } from 'vitest';
import { MAX_TILE_CACHE_MAX_BYTES, MIN_TILE_CACHE_MAX_BYTES } from '../../../src/main/map/tile-cache';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import type { ApiErrorBody, OkResponse, RadioSettingsRequest } from '../../../src/shared/api/contract';
import { DEFAULT_MAP_SETTINGS, DEFAULT_RADIO_SETTINGS, type MapSettings } from '../../../src/shared/types';
import { installSessionStub, json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

type RadioParams = Parameters<SessionAdapter['setRadioParams']>[0];

const putRadio = (body: RadioSettingsRequest) => testRoutes().request('/api/settings/radio', json('PUT', body));
const putMap = (body: unknown) => testRoutes().request('/api/settings/map', json('PUT', body));

/** A radio double recording the two writes the radio settings save can make. */
function radioStub(opts: { params?: () => Promise<boolean>; hashMode?: () => Promise<void> } = {}) {
  const setRadioParams = vi.fn((_p: RadioParams) => (opts.params ?? (() => Promise.resolve(true)))());
  const setPathHashMode = vi.fn((_size: 1 | 2 | 3) => (opts.hashMode ?? (() => Promise.resolve()))());
  installSessionStub({ setRadioParams, setPathHashMode });
  return { setRadioParams, setPathHashMode };
}

describe('PUT /api/settings/radio', () => {
  const NEXT = { ...DEFAULT_RADIO_SETTINGS, frequencyHz: 869_525_000, spreadingFactor: 8 };

  it('stores and broadcasts the settings while disconnected, without touching the radio', async () => {
    stateHolder().setRadioSettings(DEFAULT_RADIO_SETTINGS);
    const radio = radioStub();
    const broadcast = captureBus('radioSettings');

    const res = await putRadio(NEXT);

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(stateHolder().getRadioSettings()).toEqual(NEXT);
    expect(broadcast.values).toEqual([NEXT]);
    expect(radio.setRadioParams).not.toHaveBeenCalled();
  });

  it('stores locally only when pushToDevice is false, even while connected', async () => {
    stateHolder().setRadioSettings(DEFAULT_RADIO_SETTINGS);
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await putRadio({ ...NEXT, pushToDevice: false });

    expect(res.status).toBe(200);
    // The request-only flag is not part of the stored settings.
    expect(stateHolder().getRadioSettings()).toEqual(NEXT);
    expect(radio.setRadioParams).not.toHaveBeenCalled();
    expect(radio.setPathHashMode).not.toHaveBeenCalled();
  });

  it('pushes changed radio params when connected and leaves local state to the radio reply', async () => {
    stateHolder().setRadioSettings(DEFAULT_RADIO_SETTINGS);
    const radio = radioStub();
    transportManager.setState('connected');
    const broadcast = captureBus('radioSettings');

    const res = await putRadio(NEXT);

    expect(res.status).toBe(200);
    const { pathHashMode: _hashMode, ...params } = NEXT;
    expect(radio.setRadioParams).toHaveBeenCalledWith(params);
    expect(radio.setPathHashMode).not.toHaveBeenCalled();
    expect(stateHolder().getRadioSettings()).toEqual(DEFAULT_RADIO_SETTINGS);
    expect(broadcast.calls).toHaveLength(0);
  });

  it('sends only SET_PATH_HASH_MODE when only the path-hash mode changed', async () => {
    stateHolder().setRadioSettings(DEFAULT_RADIO_SETTINGS);
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await putRadio({ ...DEFAULT_RADIO_SETTINGS, pathHashMode: 3 });

    expect(res.status).toBe(200);
    expect(radio.setRadioParams).not.toHaveBeenCalled();
    expect(radio.setPathHashMode).toHaveBeenCalledWith(3);
  });

  it('sends nothing when nothing changed', async () => {
    stateHolder().setRadioSettings(DEFAULT_RADIO_SETTINGS);
    const radio = radioStub();
    transportManager.setState('connected');

    const res = await putRadio(DEFAULT_RADIO_SETTINGS);

    expect(res.status).toBe(200);
    expect(radio.setRadioParams).not.toHaveBeenCalled();
    expect(radio.setPathHashMode).not.toHaveBeenCalled();
  });

  it('answers 503 when the radio rejects SET_RADIO_PARAMS, and sends nothing after it', async () => {
    stateHolder().setRadioSettings(DEFAULT_RADIO_SETTINGS);
    const radio = radioStub({ params: () => Promise.resolve(false) });
    transportManager.setState('connected');

    const res = await putRadio({ ...NEXT, pathHashMode: 1 });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'radio rejected SET_RADIO_PARAMS or timed out' });
    expect(radio.setPathHashMode).not.toHaveBeenCalled();
    expect(stateHolder().getRadioSettings()).toEqual(DEFAULT_RADIO_SETTINGS);
  });

  // The device-settings service turns a throw into a rejection: 503, not 500.
  it('answers 503 with the message when a setter throws', async () => {
    stateHolder().setRadioSettings(DEFAULT_RADIO_SETTINGS);
    radioStub({ hashMode: () => Promise.reject(new Error('RESP_ERR: illegal arg')) });
    transportManager.setState('connected');

    const res = await putRadio({ ...DEFAULT_RADIO_SETTINGS, pathHashMode: 1 });

    expect(res.status).toBe(503);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'RESP_ERR: illegal arg' });
  });
});

describe('PUT /api/settings/map', () => {
  const NEXT: MapSettings = {
    ...DEFAULT_MAP_SETTINGS,
    styleTheme: 'dark',
    favouritesOnly: true,
    lastCenter: { lng: -122.6, lat: 45.5 },
    lastZoom: 9,
  };

  it('stores and broadcasts the settings', async () => {
    stateHolder().setMapSettings(DEFAULT_MAP_SETTINGS);
    const broadcast = captureBus('mapSettings');

    const res = await putMap(NEXT);

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(stateHolder().getMapSettings()).toEqual(NEXT);
    expect(broadcast.values).toEqual([NEXT]);
  });

  it('ignores an inbound hasProtomapsApiKey, which the server owns', async () => {
    stateHolder().setMapSettings({ ...DEFAULT_MAP_SETTINGS, hasProtomapsApiKey: false });
    await putMap({ ...NEXT, hasProtomapsApiKey: true });
    expect(stateHolder().getMapSettings().hasProtomapsApiKey).toBe(false);

    stateHolder().setMapSettings({ ...DEFAULT_MAP_SETTINGS, hasProtomapsApiKey: true });
    const { hasProtomapsApiKey: _omitted, ...withoutFlag } = NEXT;
    await putMap(withoutFlag);
    expect(stateHolder().getMapSettings().hasProtomapsApiKey).toBe(true);
  });

  it('clamps the tile-cache cap into its allowed range', async () => {
    stateHolder().setMapSettings(DEFAULT_MAP_SETTINGS);

    await putMap({ ...NEXT, tileCacheMaxBytes: 1 });
    expect(stateHolder().getMapSettings().tileCacheMaxBytes).toBe(MIN_TILE_CACHE_MAX_BYTES);

    await putMap({ ...NEXT, tileCacheMaxBytes: 1e15 });
    expect(stateHolder().getMapSettings().tileCacheMaxBytes).toBe(MAX_TILE_CACHE_MAX_BYTES);
  });
});
