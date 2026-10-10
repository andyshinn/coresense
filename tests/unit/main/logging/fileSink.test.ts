import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { currentPath, flushLogFile, setEnabled, write } from '../../../../src/main/logging/fileSink';
import { setUserDataDir } from '../../../../src/main/runtime/userData';
import type { LogEntry } from '../../../../src/shared/types';

const dir = mkdtempSync(join(tmpdir(), 'coresense-filesink-'));

afterEach(() => {
  setEnabled(false);
  setUserDataDir(null);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function entry(message: string): LogEntry {
  return { id: message, ts: 0, level: 'warn', levelId: 4, source: 'main', logger: 'coresense', message };
}

describe('flushLogFile', () => {
  it('resolves only after every pending line has been appended', async () => {
    setUserDataDir(dir);
    setEnabled(true);
    for (let i = 0; i < 20; i++) write(entry(`line ${i}`));
    write(entry('transport shutdown did not finish within 5000ms'));

    await flushLogFile();

    const lines = readFileSync(currentPath(), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(21);
    expect(JSON.parse(lines[20]).message).toBe('transport shutdown did not finish within 5000ms');
  });
});
