import { Models } from '@andyshinn/meshcore-ts';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoutes } from '../../../src/main/api/routes';
import { setProtocolSession } from '../../../src/main/protocol';
import type { SessionAdapter } from '../../../src/main/protocol/sessionAdapter';
import { stateHolder } from '../../../src/main/state/holder';
import { transportManager } from '../../../src/main/transport/manager';
import { type AutoAddConfig, DEFAULT_AUTO_ADD_CONFIG } from '../../../src/shared/types';

type AutoAddFlags = Parameters<SessionAdapter['setAutoAddConfig']>[0];
type OtherParamsCall = [Parameters<SessionAdapter['setOtherParams']>[0], boolean, number | undefined];
type LibAutoAddConfig = ReturnType<SessionAdapter['getLibAutoAddConfig']>;

interface Recorder {
  adapter: SessionAdapter;
  /** Command names in the order they went to the radio. */
  order: string[];
  flags: AutoAddFlags[];
  otherParams: OtherParamsCall[];
  /** Stands in for the library's own AutoAddConfig mirror — the radio-confirmed
   *  view the route compares against. Faithful to what 0.8.0 actually does:
   *  `setAutoAddConfig()` only encodes a frame and NEVER touches it, while
   *  `setOtherParams()` writes the manual-add byte into it. */
  mirror: LibAutoAddConfig;
}

/** A SessionAdapter double recording just the two auto-add commands. */
function recordingAdapter(opts: { ok?: boolean; mirror?: Partial<LibAutoAddConfig> } = {}): Recorder {
  const ok = opts.ok ?? true;
  const rec: Recorder = {
    adapter: null as unknown as SessionAdapter,
    order: [],
    flags: [],
    otherParams: [],
    mirror: { ...Models.DEFAULT_AUTO_ADD_CONFIG, ...opts.mirror },
  };
  rec.adapter = {
    getLibAutoAddConfig: () => rec.mirror,
    mirrorAutoAddConfig: (flags: Parameters<SessionAdapter['mirrorAutoAddConfig']>[0]) => {
      Object.assign(rec.mirror, flags);
    },
    setAutoAddConfig: async (flags: AutoAddFlags) => {
      rec.order.push('setAutoAddConfig');
      rec.flags.push(flags);
      return ok;
    },
    setOtherParams: async (...args: OtherParamsCall) => {
      rec.order.push('setOtherParams');
      rec.otherParams.push(args);
      // The library mirrors the manual-add byte the moment the frame is on the
      // wire (the firmware assigns it before any length guard), not after the ack.
      if (args[2] !== undefined) rec.mirror.manualAddContacts = args[2];
      return ok;
    },
  } as unknown as SessionAdapter;
  return rec;
}

function app() {
  return createRoutes({
    port: () => 8080,
    wsClients: () => 0,
    bridgeStatus: () => ({ running: false, clients: 0 }) as never,
  });
}

function putAutoAdd(body: AutoAddConfig) {
  return app().request('/api/device/auto-add', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** What the radio last told us: the holder copy the panel renders AND the
 *  library mirror the route consults, agreeing as they do right after a
 *  connect. */
function seedRadioState(manualAddContacts: number, radioMaxHops = 0): void {
  stateHolder().setAutoAddConfig({
    ...DEFAULT_AUTO_ADD_CONFIG,
    mode: (manualAddContacts & 1) !== 0 ? 'selected' : 'all',
    manualAddContacts,
    radioMaxHops,
  });
}

/** Seed holder + mirror, install the double and mark the transport connected. */
function connectedRadio(manualAddContacts: number, radioMaxHops = 0, ok = true): Recorder {
  seedRadioState(manualAddContacts, radioMaxHops);
  const rec = recordingAdapter({ ok, mirror: { manualAddContacts, radioMaxHops } });
  setProtocolSession(rec.adapter);
  transportManager.setState('connected');
  return rec;
}

const panelSave = (over: Partial<AutoAddConfig>): AutoAddConfig => ({
  ...DEFAULT_AUTO_ADD_CONFIG,
  ...over,
});

afterEach(() => {
  setProtocolSession(null);
  transportManager.setState('idle');
});

describe('PUT /api/device/auto-add — manual_add_contacts bit 0', () => {
  it('sends the kind flags first, then flips bit 0 on for "selected"', async () => {
    const rec = connectedRadio(0);

    const res = await putAutoAdd(panelSave({ mode: 'selected', chat: true, repeater: false, room: false, sensor: false }));

    expect(res.status).toBe(200);
    // Order matters: bit 0 arriving first would leave a window in which the
    // radio honours the PREVIOUS per-kind selection.
    expect(rec.order).toEqual(['setAutoAddConfig', 'setOtherParams']);
    expect(rec.flags[0]).toMatchObject({ chat: true, repeater: false, room: false, sensor: false });
    expect(rec.otherParams[0][2]).toBe(1);
    expect(stateHolder().getAutoAddConfig().manualAddContacts).toBe(1);
  });

  it('clears bit 0 for "all" and forces every kind flag true', async () => {
    const rec = connectedRadio(1);

    const res = await putAutoAdd(panelSave({ mode: 'all', chat: true, repeater: false, room: false, sensor: false }));

    expect(res.status).toBe(200);
    expect(rec.flags[0]).toMatchObject({ chat: true, repeater: true, room: true, sensor: true });
    expect(rec.otherParams[0][2]).toBe(0);
    expect(stateHolder().getAutoAddConfig().manualAddContacts).toBe(0);
  });

  it('preserves the reserved bits of the radio-reported byte', async () => {
    const rec = connectedRadio(0x82);

    await putAutoAdd(panelSave({ mode: 'selected' }));

    expect(rec.otherParams[0][2]).toBe(0x83);
  });

  it('does not touch SET_OTHER_PARAMS when the bit is already what the radio has', async () => {
    const rec = connectedRadio(1);

    await putAutoAdd(panelSave({ mode: 'selected', chat: false }));

    // That command also carries the telemetry + advert-location policy, so it
    // must not ride along on a save that only changed the kind flags.
    expect(rec.order).toEqual(['setAutoAddConfig']);
  });

  it('reports a distinct error when the radio rejects the mode change', async () => {
    const rec = connectedRadio(0, 0, false);

    const res = await putAutoAdd(panelSave({ mode: 'selected' }));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SET_AUTO_ADD_CONFIG/);
    expect(rec.order).toEqual(['setAutoAddConfig']);
  });

  it('persists the derived byte while disconnected without writing to the radio', async () => {
    seedRadioState(0);
    const rec = recordingAdapter();
    setProtocolSession(rec.adapter);
    transportManager.setState('idle');

    await putAutoAdd(panelSave({ mode: 'selected' }));

    expect(rec.order).toEqual([]);
    expect(stateHolder().getAutoAddConfig().manualAddContacts).toBe(1);
  });
});

describe('PUT /api/device/auto-add — the library mirror is what decides', () => {
  // Regression: the library's setAutoAddConfig() only encodes the frame, so the
  // route has to write the pushed flags into the mirror itself. Left stale, the
  // setOtherParams two lines later re-emits `autoAddConfig` built from that
  // mirror and wireSessionEvents persists the OLD kind flags straight back over
  // the selection this request just saved.
  it('writes the pushed kind flags and hop limit into the library mirror', async () => {
    const rec = connectedRadio(0, 0);

    await putAutoAdd(
      panelSave({ mode: 'selected', chat: true, repeater: false, room: false, sensor: false, radioMaxHops: 3 }),
    );

    expect(rec.mirror).toMatchObject({
      mode: 'selected',
      chat: true,
      repeater: false,
      room: false,
      sensor: false,
      radioMaxHops: 3,
      manualAddContacts: 1,
    });
  });

  it('mirrors the flags even when the mode bit did not move', async () => {
    const rec = connectedRadio(1);

    await putAutoAdd(panelSave({ mode: 'selected', chat: true, repeater: false, room: false, sensor: false }));

    expect(rec.order).toEqual(['setAutoAddConfig']);
    expect(rec.mirror).toMatchObject({ chat: true, repeater: false, room: false, sensor: false });
  });

  // Regression: the change detection used to compare against the holder, which
  // line 1 of this route has already overwritten optimistically. A mode change
  // saved while disconnected therefore looked "already applied" forever and the
  // radio was never told — leaving the four kind toggles decorative, which is
  // the entire bug this route exists to fix.
  it('re-sends the mode bit on the next connected save when the radio never got it', async () => {
    seedRadioState(0);
    const offline = recordingAdapter();
    setProtocolSession(offline.adapter);
    transportManager.setState('idle');
    await putAutoAdd(panelSave({ mode: 'selected' }));
    expect(stateHolder().getAutoAddConfig().manualAddContacts).toBe(1);

    // Radio attaches. RESP_SELF_INFO reports bit 0 clear, which matches the
    // library's mirror, so nothing emits and nothing corrects the holder.
    const rec = recordingAdapter({ mirror: { manualAddContacts: 0 } });
    setProtocolSession(rec.adapter);
    transportManager.setState('connected');

    await putAutoAdd(panelSave({ mode: 'selected', chat: true, repeater: false, room: false, sensor: false }));

    expect(rec.order).toEqual(['setAutoAddConfig', 'setOtherParams']);
    expect(rec.otherParams.at(-1)?.[2]).toBe(1);
  });

  it('re-sends the mode bit after the radio rejected the first attempt', async () => {
    const rejecting = connectedRadio(0, 0, false);
    expect((await putAutoAdd(panelSave({ mode: 'selected' }))).status).toBe(503);
    expect(rejecting.order).toEqual(['setAutoAddConfig']);

    const rec = recordingAdapter({ mirror: { manualAddContacts: 0 } });
    setProtocolSession(rec.adapter);

    await putAutoAdd(panelSave({ mode: 'selected' }));

    expect(rec.otherParams.at(-1)?.[2]).toBe(1);
  });
});

describe('PUT /api/device/auto-add — autoadd_max_hops', () => {
  it('omits the hops byte when the control did not move, so the radio keeps its value', async () => {
    const rec = connectedRadio(0, 4);

    await putAutoAdd(panelSave({ mode: 'all', radioMaxHops: 4 }));

    expect(rec.flags[0].radioMaxHops).toBeUndefined();
  });

  it('sends the hops byte when the user changed it', async () => {
    const rec = connectedRadio(0, 4);

    await putAutoAdd(panelSave({ mode: 'all', radioMaxHops: 2 }));

    expect(rec.flags[0].radioMaxHops).toBe(2);
  });

  it('delivers a hop limit edited while disconnected on the next connected save', async () => {
    seedRadioState(0, 0);
    const offline = recordingAdapter();
    setProtocolSession(offline.adapter);
    transportManager.setState('idle');
    await putAutoAdd(panelSave({ mode: 'all', radioMaxHops: 3 }));

    // Holder now says 3 and the radio still says 0. Comparing the next save
    // against the holder would call it unchanged and emit the 2-byte form,
    // which the firmware reads as "keep what you have".
    const rec = recordingAdapter({ mirror: { radioMaxHops: 0 } });
    setProtocolSession(rec.adapter);
    transportManager.setState('connected');

    await putAutoAdd(panelSave({ mode: 'all', radioMaxHops: 3 }));

    expect(rec.flags[0].radioMaxHops).toBe(3);
  });
});
