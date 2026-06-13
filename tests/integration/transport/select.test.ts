import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileReplayTransport } from '../../../src/main/transport/replay';
import { installStartupTransport } from '../../../src/main/transport/select';
import type { ITransport } from '../../../src/main/transport/types';

describe('installStartupTransport', () => {
  it('installs a FileReplayTransport when CORESENSE_FAKE_TRANSPORT is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'select-test-'));
    const fixture = join(dir, 'frames.json');
    writeFileSync(fixture, JSON.stringify([]));

    let installed: ITransport | null = null;
    const manager = {
      setTransport: (t: ITransport) => {
        installed = t;
      },
    };

    const result = await installStartupTransport({ CORESENSE_FAKE_TRANSPORT: fixture } as NodeJS.ProcessEnv, manager);

    expect(installed).toBeInstanceOf(FileReplayTransport);
    expect(result).toBe(installed);
  });
});
