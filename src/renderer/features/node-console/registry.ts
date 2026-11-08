// The My Node console's commands. Each maps to the API calls the rest of the
// app already uses: writes go through the same routes, and the same shared
// validation, as Radio Settings and Public Info.

import { parseCoord } from '../../../shared/geo';
import { validateNodeName, validateTxPower } from '../../../shared/radio';
import { fmtSnr } from '../../lib/signal';
import { fmtBandwidth, fmtFirmware, fmtFreqMhz } from '../../shell/leftnav/ownerFormat';
import { parseConsoleLine } from './parse';
import { type ConsoleOutput, type ConsolePort, ConsoleUsageError, type NodeCommand } from './types';

const out = (...lines: string[]): ConsoleOutput => ({ lines });

/** Thousands separators for counters; mono and tabular in the transcript. */
const count = (n: number) => n.toLocaleString('en-US');

function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} m`;
  if (m > 0) return `${m} m ${s % 60} s`;
  return `${s} s`;
}

function fmtCoord(v: number | null): string {
  return v === null ? 'not set' : v.toFixed(5);
}

function requireArgs(cmd: NodeCommand, args: string[], n: number): void {
  if (args.length !== n) throw new ConsoleUsageError(`usage: ${cmd.name}${cmd.spec ? ` ${cmd.spec}` : ''}`);
}

function coordCommand(axis: 'lat' | 'lon'): NodeCommand {
  const label = axis === 'lat' ? 'Latitude' : 'Longitude';
  const cmd: NodeCommand = {
    name: `set ${axis}`,
    group: 'Position',
    desc: `Set the advertised ${label.toLowerCase()}, decimal degrees`,
    spec: '<deg>',
    args: [{ name: 'deg', hint: axis === 'lat' ? '-90 to 90' : '-180 to 180' }],
    action: `Set ${label.toLowerCase()}`,
    needsRadio: true,
    async run(port, args) {
      requireArgs(cmd, args, 1);
      const parsed = parseCoord(args[0], axis, { maxDecimals: 5 });
      if (!parsed.ok) throw new ConsoleUsageError(parsed.error);
      await port.putDeviceIdentity({ [axis]: parsed.value });
      return out(`${label} set to ${parsed.value.toFixed(5)}`);
    },
  };
  return cmd;
}

const getName: NodeCommand = {
  name: 'get name',
  group: 'Identity',
  desc: 'The advertised node name',
  action: 'Get name',
  needsRadio: true,
  run: async (port) => out(port.getState().deviceIdentity.name || '(no name)'),
};

const setName: NodeCommand = {
  name: 'set name',
  group: 'Identity',
  desc: 'Set the advertised node name (at most 31 bytes)',
  spec: '<text>',
  args: [{ name: 'text', hint: 'up to 31 bytes' }],
  restArg: true,
  action: 'Set name',
  needsRadio: true,
  async run(port, args) {
    requireArgs(setName, args, 1);
    const name = validateNodeName(args[0]);
    if (!name.ok) throw new ConsoleUsageError(name.error);
    await port.putDeviceIdentity({ name: name.value });
    return out(`Name set to ${name.value}`);
  },
};

const setTx: NodeCommand = {
  name: 'set tx',
  group: 'Radio',
  desc: 'Set TX power, through the same path as Radio Settings',
  spec: '<dBm>',
  args: [{ name: 'dBm', hint: 'whole dBm' }],
  action: 'Set TX power',
  needsRadio: true,
  async run(port, args) {
    requireArgs(setTx, args, 1);
    if (!/^[+-]?\d+$/.test(args[0])) throw new ConsoleUsageError('TX power must be a whole number of dBm');
    const dbm = Number(args[0]);
    const limits = port.getState().radioLimits;
    const checked = validateTxPower(dbm, limits);
    if (!checked.ok) throw new ConsoleUsageError(checked.error);
    // Only the field being changed: main merges it onto the radio's values.
    await port.putDeviceRadio({ txPowerDbm: checked.value });
    return out(`TX power set to ${checked.value} dBm`);
  },
};

function advertCommand(flood: boolean): NodeCommand {
  return {
    name: flood ? 'advert flood' : 'advert zerohop',
    group: 'Advert',
    desc: flood ? 'Send a self-advert across the mesh' : 'Send a self-advert to direct neighbours only',
    action: 'Self-advert',
    needsRadio: true,
    async run(port) {
      await port.sendAdvert(flood);
      return out(`Self-advert sent · ${flood ? 'flood' : 'zero-hop'}`);
    },
  };
}

const ver: NodeCommand = {
  name: 'ver',
  group: 'Info',
  desc: 'Model, firmware and build',
  action: 'Version',
  needsRadio: true,
  async run(port) {
    const info = port.getState().deviceInfo;
    return out(
      `${info.deviceModel || 'Unknown model'} · ${fmtFirmware(info.firmwareVersion, info.firmwareVerCode)}`,
      `build ${info.firmwareBuildDate || '—'}`,
    );
  },
};

const getRadio: NodeCommand = {
  name: 'get radio',
  group: 'Radio',
  desc: 'Frequency, bandwidth, SF, CR, TX power and repeat',
  action: 'Get radio',
  needsRadio: true,
  async run(port) {
    const r = port.getState().radioSettings;
    return out(
      `${fmtFreqMhz(r.frequencyHz)} MHz · BW ${fmtBandwidth(r.bandwidthHz)} · SF ${r.spreadingFactor} · CR 4/${r.codingRate}`,
      `TX ${r.txPowerDbm} dBm · repeat ${r.repeatMode ? 'on' : 'off'}`,
    );
  },
};

const getLat: NodeCommand = {
  name: 'get lat',
  group: 'Position',
  desc: 'The advertised latitude',
  action: 'Get latitude',
  needsRadio: true,
  run: async (port) => out(fmtCoord(port.getState().deviceIdentity.lat)),
};

const getLon: NodeCommand = {
  name: 'get lon',
  group: 'Position',
  desc: 'The advertised longitude',
  action: 'Get longitude',
  needsRadio: true,
  run: async (port) => out(fmtCoord(port.getState().deviceIdentity.lon)),
};

const statsRadio: NodeCommand = {
  name: 'stats radio',
  group: 'Radio',
  desc: 'Noise floor, last RSSI and SNR, airtime',
  action: 'Radio stats',
  needsRadio: true,
  async run(port) {
    const { radio, core } = await port.getDeviceStats();
    return out(
      `noise floor ${radio.noiseFloor} dBm · last RSSI ${radio.lastRssi} dBm · last SNR ${fmtSnr(radio.lastSnrDb)}`,
      `TX air ${fmtDuration(radio.txAirSecs)} · RX air ${fmtDuration(radio.rxAirSecs)} · uptime ${fmtDuration(core.uptimeSecs)}`,
    );
  },
};

const statsPackets: NodeCommand = {
  name: 'stats packets',
  group: 'Radio',
  desc: 'Packets received and sent since boot',
  action: 'Packet stats',
  needsRadio: true,
  async run(port) {
    const { packets: p } = await port.getDeviceStats();
    return out(
      `received ${count(p.recv)} (flood ${count(p.nRecvFlood)} · direct ${count(p.nRecvDirect)}) · errors ${count(p.nRecvErrors)}`,
      `sent ${count(p.sent)} (flood ${count(p.nSentFlood)} · direct ${count(p.nSentDirect)})`,
    );
  },
};

const clock: NodeCommand = {
  name: 'clock',
  group: 'Info',
  desc: "The radio's clock, and how far it is from this computer's",
  action: 'Clock',
  needsRadio: true,
  async run(port) {
    const secs = await port.getDeviceClockSecs();
    const drift = Math.round(secs - port.now() / 1000);
    const when = new Date(secs * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, ' UTC');
    const relation =
      drift === 0
        ? 'in step with this computer'
        : `${fmtDuration(Math.abs(drift))} ${drift > 0 ? 'ahead of' : 'behind'} this computer`;
    return out(`${when} · ${relation}`);
  },
};

const help: NodeCommand = {
  name: 'help',
  group: 'Info',
  desc: 'List every command',
  action: 'Help',
  needsRadio: false,
  run: async () => out(...NODE_COMMANDS.map((c) => `${c.name}${c.spec ? ` ${c.spec}` : ''} — ${c.desc}`)),
};

/** Every command, in help order. */
export const NODE_COMMANDS: readonly NodeCommand[] = [
  help,
  ver,
  clock,
  getName,
  setName,
  getRadio,
  setTx,
  statsRadio,
  statsPackets,
  getLat,
  getLon,
  coordCommand('lat'),
  coordCommand('lon'),
  advertCommand(true),
  advertCommand(false),
];

export type ConsoleResult =
  | { kind: 'empty' }
  | { kind: 'ok'; cmd: NodeCommand; lines: string[] }
  | { kind: 'error'; cmd: NodeCommand | null; message: string };

/** Parse and run one line. Never rejects: every failure is an error result in
 *  the house format "<Action> failed: <reason>". */
export async function runConsoleLine(line: string, port: ConsolePort): Promise<ConsoleResult> {
  const parsed = parseConsoleLine(line, NODE_COMMANDS);
  if (parsed.kind === 'empty') return { kind: 'empty' };
  if (parsed.kind === 'unknown') return { kind: 'error', cmd: null, message: parsed.message };
  const { cmd, args } = parsed;
  if (cmd.needsRadio && !port.getState().connected) {
    return { kind: 'error', cmd, message: 'Connect a radio to use the console.' };
  }
  try {
    const result = await cmd.run(port, args);
    return { kind: 'ok', cmd, lines: result.lines };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: 'error', cmd, message: `${cmd.action} failed: ${reason}` };
  }
}
