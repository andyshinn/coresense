import { describe, expect, it, vi } from 'vitest';
import { didYouMean, editDistance } from '../../../../src/renderer/features/node-console/didYouMean';
import { parseConsoleLine, tokenize } from '../../../../src/renderer/features/node-console/parse';
import { NODE_COMMANDS, runConsoleLine } from '../../../../src/renderer/features/node-console/registry';
import type { ConsolePort, ConsoleState } from '../../../../src/renderer/features/node-console/types';
import {
  DEFAULT_DEVICE_IDENTITY,
  DEFAULT_DEVICE_INFO,
  DEFAULT_RADIO_SETTINGS,
  type DeviceStats,
} from '../../../../src/shared/types';

const STATS: DeviceStats = {
  core: { kind: 'core', battMv: 4100, uptimeSecs: 7_380, errFlags: 0, queueLen: 0 },
  radio: { kind: 'radio', noiseFloor: -112, lastRssi: -84, lastSnrDb: 7.25, txAirSecs: 22, rxAirSecs: 95 },
  packets: {
    kind: 'packets',
    recv: 18_442,
    sent: 1_204,
    nSentFlood: 900,
    nSentDirect: 304,
    nRecvFlood: 15_210,
    nRecvDirect: 3_232,
    nRecvErrors: 12,
  },
  at: 0,
};

function makePort(over: Partial<ConsoleState> = {}) {
  const state: ConsoleState = {
    connected: true,
    deviceInfo: { ...DEFAULT_DEVICE_INFO, deviceModel: 'Heltec T114', firmwareVersion: 'v1.17.1', firmwareVerCode: 13 },
    deviceIdentity: { ...DEFAULT_DEVICE_IDENTITY, name: 'Base', lat: 45.5, lon: -122.6 },
    radioSettings: {
      ...DEFAULT_RADIO_SETTINGS,
      frequencyHz: 910_525_000,
      bandwidthHz: 250_000,
      spreadingFactor: 11,
      codingRate: 5,
      txPowerDbm: 20,
    },
    radioLimits: { minTxPowerDbm: -9, maxTxPowerDbm: 22 },
    ...over,
  };
  const port = {
    getState: () => state,
    sendAdvert: vi.fn(async (_flood: boolean) => {}),
    putDeviceIdentity: vi.fn(async (_patch: object) => {}),
    putDeviceRadio: vi.fn(async (_patch: object) => {}),
    getDeviceStats: vi.fn(async () => STATS),
    getDeviceClockSecs: vi.fn(async () => 1_760_000_002),
    now: () => 1_760_000_000_000,
  } satisfies ConsolePort;
  return port;
}

describe('editDistance / didYouMean', () => {
  it('counts edits, including an adjacent swap as one', () => {
    expect(editDistance('stats', 'stats')).toBe(0);
    expect(editDistance('stat', 'stats')).toBe(1);
    expect(editDistance('stast', 'stats')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('suggests a unique prefix outright, else the closest within two edits', () => {
    expect(didYouMean('stat', ['help', 'stats', 'set'])).toBe('stats');
    expect(didYouMean('adv', ['advert', 'clock'])).toBe('advert');
    expect(didYouMean('clok', ['clock', 'help'])).toBe('clock');
    expect(didYouMean('zzzzz', ['clock', 'help'])).toBeNull();
    expect(didYouMean('', ['clock'])).toBeNull();
  });
});

describe('parseConsoleLine', () => {
  it('splits on whitespace and keeps quoted runs together', () => {
    expect(tokenize('  set   name "Base Camp" ')).toEqual(['set', 'name', 'Base Camp']);
  });

  it('resolves every registered command by its own name', () => {
    for (const cmd of NODE_COMMANDS) {
      const parsed = parseConsoleLine(cmd.name, NODE_COMMANDS);
      expect(parsed.kind === 'command' && parsed.cmd.name).toBe(cmd.name);
    }
    expect(new Set(NODE_COMMANDS.map((c) => c.name)).size).toBe(NODE_COMMANDS.length);
  });

  it('is case-insensitive on command words and keeps arguments as typed', () => {
    const parsed = parseConsoleLine('SET Name Base', NODE_COMMANDS);
    expect(parsed).toMatchObject({ kind: 'command', args: ['Base'] });
  });

  it('gives set name the rest of the line, quoted or not', () => {
    expect(parseConsoleLine('set name Base Camp 2', NODE_COMMANDS)).toMatchObject({ args: ['Base Camp 2'] });
    expect(parseConsoleLine('set name "Base Camp"', NODE_COMMANDS)).toMatchObject({ args: ['Base Camp'] });
  });

  it('suggests the closest command for a mistyped first word', () => {
    expect(parseConsoleLine('stat', NODE_COMMANDS)).toEqual({
      kind: 'unknown',
      message: 'Unknown command: stat — did you mean stats?',
    });
  });

  it('suggests the closest subcommand when the first word is known', () => {
    expect(parseConsoleLine('get radi', NODE_COMMANDS)).toEqual({
      kind: 'unknown',
      message: 'Unknown command: get radi — did you mean get radio?',
    });
    expect(parseConsoleLine('advert flod', NODE_COMMANDS)).toMatchObject({
      message: 'Unknown command: advert flod — did you mean advert flood?',
    });
  });

  it('points to help when nothing is close', () => {
    expect(parseConsoleLine('reboot now', NODE_COMMANDS)).toEqual({
      kind: 'unknown',
      message: 'Unknown command: reboot — type help to list commands',
    });
    expect(parseConsoleLine('get firmware', NODE_COMMANDS)).toMatchObject({
      message: 'Unknown command: get firmware — type help to list commands',
    });
  });

  it('lists the subcommands for a bare first word', () => {
    expect(parseConsoleLine('advert', NODE_COMMANDS)).toEqual({
      kind: 'unknown',
      message: 'advert needs one of: flood, zerohop',
    });
  });

  it('treats a blank line as empty', () => {
    expect(parseConsoleLine('   ', NODE_COMMANDS)).toEqual({ kind: 'empty' });
  });
});

describe('runConsoleLine: writes', () => {
  it('set tx sends only the TX power, through the radio patch route', async () => {
    const port = makePort();

    const res = await runConsoleLine('set tx 18', port);

    expect(res).toMatchObject({ kind: 'ok', lines: ['TX power set to 18 dBm'] });
    expect(port.putDeviceRadio).toHaveBeenCalledWith({ txPowerDbm: 18 });
  });

  it('set tx refuses a value outside the radio range before sending', async () => {
    const port = makePort();

    const res = await runConsoleLine('set tx 23', port);

    expect(res).toMatchObject({
      kind: 'error',
      message: 'Set TX power failed: TX power must be at most 22 dBm on this radio',
    });
    expect(port.putDeviceRadio).not.toHaveBeenCalled();
  });

  it.each([['10.5'], ['ten'], ['1e1']])('set tx refuses %j', async (arg) => {
    const port = makePort();
    const res = await runConsoleLine(`set tx ${arg}`, port);
    expect(res).toMatchObject({ kind: 'error', message: 'Set TX power failed: TX power must be a whole number of dBm' });
    expect(port.putDeviceRadio).not.toHaveBeenCalled();
  });

  it('set tx reports the server refusal in the house format', async () => {
    const port = makePort({ radioLimits: { minTxPowerDbm: -9, maxTxPowerDbm: null } });
    port.putDeviceRadio.mockRejectedValueOnce(new Error('TX power limit not known yet'));

    const res = await runConsoleLine('set tx 10', port);

    expect(res).toMatchObject({ kind: 'error', message: 'Set TX power failed: TX power limit not known yet' });
  });

  it('set tx without an argument prints its usage', async () => {
    const res = await runConsoleLine('set tx', makePort());
    expect(res).toMatchObject({ kind: 'error', message: 'Set TX power failed: usage: set tx <dBm>' });
  });

  it('set name validates and sends the normalised name', async () => {
    const port = makePort();

    expect(await runConsoleLine('set name   Base Camp ', port)).toMatchObject({ lines: ['Name set to Base Camp'] });
    expect(port.putDeviceIdentity).toHaveBeenCalledWith({ name: 'Base Camp' });

    const tooLong = await runConsoleLine(`set name ${'x'.repeat(32)}`, port);
    expect(tooLong).toMatchObject({ kind: 'error', message: 'Set name failed: Name must be at most 31 bytes (it is 32)' });
    expect(port.putDeviceIdentity).toHaveBeenCalledTimes(1);
  });

  it('set lat / set lon take at most 5 decimal places and the valid range', async () => {
    const port = makePort();

    expect(await runConsoleLine('set lat 45.12345', port)).toMatchObject({ lines: ['Latitude set to 45.12345'] });
    expect(port.putDeviceIdentity).toHaveBeenCalledWith({ lat: 45.12345 });
    expect(await runConsoleLine('set lon -181', port)).toMatchObject({
      message: 'Set longitude failed: Longitude must be between -180 and 180',
    });
    expect(await runConsoleLine('set lat 45.123456', port)).toMatchObject({
      message: 'Set latitude failed: Latitude allows at most 5 decimal places',
    });
    expect(port.putDeviceIdentity).toHaveBeenCalledTimes(1);
  });

  it('advert flood / zerohop send the matching self-advert', async () => {
    const port = makePort();

    expect(await runConsoleLine('advert flood', port)).toMatchObject({ lines: ['Self-advert sent · flood'] });
    expect(await runConsoleLine('advert zerohop', port)).toMatchObject({ lines: ['Self-advert sent · zero-hop'] });
    expect(port.sendAdvert.mock.calls).toEqual([[true], [false]]);
  });

  it('formats a radio-side failure as "<Action> failed: <reason>"', async () => {
    const port = makePort();
    port.sendAdvert.mockRejectedValueOnce(new Error('table full'));

    expect(await runConsoleLine('advert flood', port)).toMatchObject({
      kind: 'error',
      message: 'Self-advert failed: table full',
    });
  });
});

describe('runConsoleLine: reads', () => {
  it('get radio formats the radio params with units', async () => {
    expect(await runConsoleLine('get radio', makePort())).toMatchObject({
      lines: ['910.525 MHz · BW 250 kHz · SF 11 · CR 4/5', 'TX 20 dBm · repeat off'],
    });
  });

  it('get name / get lat / get lon / ver read the mirrored state', async () => {
    const port = makePort();
    expect(await runConsoleLine('get name', port)).toMatchObject({ lines: ['Base'] });
    expect(await runConsoleLine('get lat', port)).toMatchObject({ lines: ['45.50000'] });
    expect(await runConsoleLine('get lon', makePort({ deviceIdentity: { ...DEFAULT_DEVICE_IDENTITY } }))).toMatchObject({
      lines: ['not set'],
    });
    expect(await runConsoleLine('ver', port)).toMatchObject({ lines: ['Heltec T114 · v1.17.1 (ver 13)', 'build —'] });
  });

  it('stats radio and stats packets read the local stats', async () => {
    const port = makePort();
    expect(await runConsoleLine('stats radio', port)).toMatchObject({
      lines: [
        'noise floor -112 dBm · last RSSI -84 dBm · last SNR 7.25dB',
        'TX air 22 s · RX air 1 m 35 s · uptime 2 h 3 m',
      ],
    });
    expect(await runConsoleLine('stats packets', port)).toMatchObject({
      lines: ['received 18,442 (flood 15,210 · direct 3,232) · errors 12', 'sent 1,204 (flood 900 · direct 304)'],
    });
  });

  it('clock shows the radio time and its drift from this computer', async () => {
    expect(await runConsoleLine('clock', makePort())).toMatchObject({
      lines: ['2025-10-09 08:53:22 UTC · 2 s ahead of this computer'],
    });
  });

  it('help lists every command', async () => {
    const res = await runConsoleLine('help', makePort());
    expect(res.kind === 'ok' && res.lines).toHaveLength(NODE_COMMANDS.length);
    expect(res.kind === 'ok' && res.lines).toContain('set tx <dBm> — Set TX power, through the same path as Radio Settings');
  });
});

describe('runConsoleLine: no radio', () => {
  it('refuses radio commands while disconnected, but help still works', async () => {
    const port = makePort({ connected: false });

    expect(await runConsoleLine('get radio', port)).toMatchObject({
      kind: 'error',
      message: 'Connect a radio to use the console.',
    });
    expect((await runConsoleLine('help', port)).kind).toBe('ok');
  });

  it('reports an unknown command whatever the connection', async () => {
    expect(await runConsoleLine('stat', makePort({ connected: false }))).toEqual({
      kind: 'error',
      cmd: null,
      message: 'Unknown command: stat — did you mean stats?',
    });
  });
});
