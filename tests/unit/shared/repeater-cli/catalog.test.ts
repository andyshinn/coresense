import { describe, expect, it } from 'vitest';
import type { CliGroup } from '../../../../src/shared/repeater-cli/catalog';
import {
  CLI_BY_NAME,
  CLI_COMMANDS,
  CLI_GETTER_BY_KEY,
  CLI_GROUP_ORDER,
  CLI_SETTER_BY_KEY,
  isGetter,
  isSetter,
} from '../../../../src/shared/repeater-cli/catalog';

const EXPECTED_GROUPS: CliGroup[] = [
  'Operational',
  'Neighbors',
  'Statistics',
  'Logging',
  'Info',
  'Radio',
  'System',
  'Routing',
  'ACL',
  'Region',
  'GPS',
];

describe('CLI catalog invariants', () => {
  it('lists every CliGroup in CLI_GROUP_ORDER exactly once', () => {
    expect([...CLI_GROUP_ORDER]).toEqual(EXPECTED_GROUPS);
  });

  it('has unique command names', () => {
    const names = CLI_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('places every command in a known group', () => {
    for (const c of CLI_COMMANDS) {
      expect(EXPECTED_GROUPS).toContain(c.group);
    }
  });

  it('exposes every command through CLI_BY_NAME', () => {
    expect(Object.keys(CLI_BY_NAME).length).toBe(CLI_COMMANDS.length);
    for (const c of CLI_COMMANDS) {
      expect(CLI_BY_NAME[c.name]).toBe(c);
    }
  });

  it('every enumDesc key is a member of that arg enum', () => {
    for (const c of CLI_COMMANDS) {
      for (const arg of c.args ?? []) {
        if (!arg.enumDesc) continue;
        for (const k of Object.keys(arg.enumDesc)) {
          expect(arg.enum ?? []).toContain(k);
        }
      }
    }
  });

  it('a get/set pair shares a key (serial-only pairs are exempt)', () => {
    // prv.key is the exempt case: `get prv.key` is serial-gated, so prefilling
    // `set prv.key` with the current private key is neither possible nor wanted.
    for (const set of CLI_COMMANDS) {
      if (!set.name.startsWith('set ')) continue;
      const get = CLI_BY_NAME[`get ${set.name.slice(4)}`];
      if (!get) continue;
      if (set.serialOnly || get.serialOnly) continue;
      expect(get.key, `${get.name} needs a key`).toBeTruthy();
      expect(set.key).toBe(get.key);
    }
  });

  it('marks the Operational/Statistics/Logging serial-only commands by name', () => {
    for (const name of ['erase', 'log', 'stats-packets', 'stats-radio', 'stats-core']) {
      expect(CLI_BY_NAME[name]?.serialOnly, `${name} should be serialOnly`).toBe(true);
    }
  });

  it('marks the no-reply reboot/power commands by name', () => {
    for (const name of ['reboot', 'poweroff', 'clkreboot']) {
      expect(CLI_BY_NAME[name]?.noReply, `${name} should be noReply`).toBe(true);
    }
    // erase writes a serial reply, so it is serial-only but NOT noReply.
    expect(CLI_BY_NAME.erase?.noReply).toBeUndefined();
  });

  it('marks the Radio/System serial-only commands by name', () => {
    expect(CLI_BY_NAME['set freq']?.serialOnly).toBe(true);
    expect(CLI_BY_NAME['get prv.key']?.serialOnly).toBe(true);
  });

  it('reboot-required set commands are flagged by name', () => {
    for (const name of ['set radio', 'set freq', 'set prv.key']) {
      expect(CLI_BY_NAME[name]?.reboot, `${name} should be reboot`).toBe(true);
    }
  });

  it('carries the reconciled Routing enums and the added flood.max.unscoped pair', () => {
    expect(CLI_BY_NAME['set loop.detect']?.args?.[0].enum).toEqual(['off', 'minimal', 'moderate', 'strict']);
    expect(CLI_BY_NAME['set path.hash.mode']?.args?.[0].enum).toEqual(['0', '1', '2']);
    expect(CLI_BY_NAME['get flood.max.unscoped']?.key).toBe('flood.max.unscoped');
    expect(CLI_BY_NAME['set flood.max.unscoped']?.key).toBe('flood.max.unscoped');
  });

  it('resolves the ACL and Region reconciliation questions by name', () => {
    expect(CLI_BY_NAME['get acl']?.serialOnly).toBe(true);
    // region list is NOT serial — handleRegionCmd has no sender_timestamp guard.
    expect(CLI_BY_NAME['region list']?.serialOnly).toBeUndefined();
    // region load writes no reply.
    expect(CLI_BY_NAME['region load']?.noReply).toBe(true);
  });

  it('lists the four setperm permission levels', () => {
    expect(CLI_BY_NAME.setperm?.args?.[1].enum).toEqual(['0', '1', '2', '3']);
  });

  it('flags only reboot and clkreboot as restarting the node', () => {
    const rebooting = CLI_COMMANDS.filter((c) => c.rebootsNode).map((c) => c.name);
    expect(rebooting).toEqual(['reboot', 'clkreboot']);
  });
});

describe('get/set indexes by key', () => {
  it('pairs each key with at most one getter and one setter', () => {
    for (const pick of [isGetter, isSetter]) {
      const keys = CLI_COMMANDS.filter((c) => c.key && pick(c)).map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('indexes every keyed getter and setter', () => {
    for (const c of CLI_COMMANDS) {
      if (!c.key) continue;
      if (isGetter(c)) expect(CLI_GETTER_BY_KEY.get(c.key)).toBe(c);
      if (isSetter(c)) expect(CLI_SETTER_BY_KEY.get(c.key)).toBe(c);
    }
  });

  it('finds the sibling of a pair and skips single-command keys', () => {
    expect(CLI_SETTER_BY_KEY.get('radio')?.name).toBe('set radio');
    expect(CLI_GETTER_BY_KEY.get('radio')?.name).toBe('get radio');
    // `gps` carries a key but is neither half of a get/set pair.
    expect(CLI_GETTER_BY_KEY.has('gps')).toBe(false);
    expect(CLI_SETTER_BY_KEY.has('gps')).toBe(false);
  });
});
