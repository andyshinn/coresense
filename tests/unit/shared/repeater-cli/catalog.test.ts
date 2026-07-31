import { describe, expect, it } from 'vitest';
import type { CliGroup } from '../../../../src/shared/repeater-cli/catalog';
import { CLI_BY_NAME, CLI_COMMANDS, CLI_GROUP_ORDER } from '../../../../src/shared/repeater-cli/catalog';

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
});
