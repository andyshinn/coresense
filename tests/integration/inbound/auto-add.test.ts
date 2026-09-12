import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { bus } from '../../../src/main/events/bus';
import { stateHolder } from '../../../src/main/state/holder';
import { DEFAULT_AUTO_ADD_CONFIG } from '../../../src/shared/types';
import { frameBuf } from '../../support/frames';
import { makeTestSession } from '../../support/session-harness';

/** The captured RESP_SELF_INFO fixture with `manual_add_contacts` (byte 47)
 *  overridden — the only frame that ever reports the radio's auto-add master
 *  switch. */
function selfInfo(manualAddContacts: number): Buffer {
  const frame = frameBuf('selfInfo');
  frame[47] = manualAddContacts;
  return frame;
}

/** A user's saved selection: manual-add mode with only chat ticked. */
function seedUserSelection(): void {
  stateHolder().setAutoAddConfig({
    ...DEFAULT_AUTO_ADD_CONFIG,
    mode: 'all',
    chat: true,
    repeater: false,
    room: false,
    sensor: false,
    radioMaxHops: 7,
    manualAddContacts: 0,
    // Non-default on purpose: the app-only field the library's payload never
    // carries has to come back from the holder, not from a default.
    autoRefreshContacts: true,
  });
}

describe('RESP_AUTOADD_CONFIG folds the flags byte into auto-add config', () => {
  it('maps the flags byte into auto-add config and emits autoAddConfig', async () => {
    const { receive } = makeTestSession();

    const seen: Array<{ chat: boolean; repeater: boolean; overwriteOldest: boolean }> = [];
    const onCfg = (c: { chat: boolean; repeater: boolean; overwriteOldest: boolean }) => {
      seen.push(c);
    };
    bus.on('autoAddConfig', onCfg);

    receive(Buffer.from([0x19, 0x06])); // chat(0x02)|repeater(0x04)
    await Promise.resolve();
    bus.off('autoAddConfig', onCfg);

    const cfg = seen.at(-1);
    expect(cfg?.chat).toBe(true);
    expect(cfg?.repeater).toBe(true);
    expect(cfg?.overwriteOldest).toBe(false);
  });

  it('carries the radio autoadd_max_hops byte through and keeps the manual-add byte', () => {
    stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG, manualAddContacts: 1, mode: 'selected' });
    const { receive } = makeTestSession();

    receive(Buffer.from([0x19, 0x02, 0x05])); // chat only, autoadd_max_hops = 5

    const cfg = stateHolder().getAutoAddConfig();
    expect(cfg.radioMaxHops).toBe(5);
    // RESP_AUTOADD_CONFIG says nothing about manual_add_contacts, so the value
    // learned from RESP_SELF_INFO must survive it — it is what the next
    // SET_OTHER_PARAMS puts back on the wire.
    expect(cfg.manualAddContacts).toBe(1);
    expect(cfg.mode).toBe('selected');
  });
});

describe('RESP_SELF_INFO manual_add_contacts (byte 47)', () => {
  it('records the byte and derives mode from bit 0', () => {
    seedUserSelection();
    const { receive } = makeTestSession();

    receive(selfInfo(0x01));

    const cfg = stateHolder().getAutoAddConfig();
    expect(cfg.manualAddContacts).toBe(0x01);
    // The library never writes its own `mode`; bit 0 is the radio's answer.
    expect(cfg.mode).toBe('selected');
  });

  it('preserves reserved bits above bit 0', () => {
    seedUserSelection();
    const { receive } = makeTestSession();

    receive(selfInfo(0x83));

    expect(stateHolder().getAutoAddConfig().manualAddContacts).toBe(0x83);
    expect(stateHolder().getAutoAddConfig().mode).toBe('selected');
  });

  it('does not wipe the saved per-kind selection or app-only fields', () => {
    seedUserSelection();
    const { receive } = makeTestSession();

    receive(selfInfo(0x01));

    const cfg = stateHolder().getAutoAddConfig();
    // This emit is driven by RESP_SELF_INFO, which reports ONLY the manual-add
    // byte. Every other field in the payload is the library's mirror, seeded
    // from this holder at session start — so an unrelated field must come back
    // unchanged rather than as a library default.
    expect(cfg.repeater).toBe(false);
    expect(cfg.room).toBe(false);
    expect(cfg.sensor).toBe(false);
    expect(cfg.chat).toBe(true);
    expect(cfg.radioMaxHops).toBe(7);
    expect(cfg.autoRefreshContacts).toBe(true);
  });

  it('derives mode back to "all" when the radio reports bit 0 clear', () => {
    stateHolder().setAutoAddConfig({ ...DEFAULT_AUTO_ADD_CONFIG, mode: 'selected', manualAddContacts: 1 });
    const { receive } = makeTestSession();

    receive(selfInfo(0x00));

    expect(stateHolder().getAutoAddConfig().mode).toBe('all');
    expect(stateHolder().getAutoAddConfig().manualAddContacts).toBe(0);
  });
});
