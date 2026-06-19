import childProcess from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The hook calls execFileSync from node:child_process; mock it so no real
// signtool is invoked. We spy on the child_process module object directly so
// the CJS require() binding in the hook picks up the same reference.
const execFileSyncSpy = vi.spyOn(childProcess, 'execFileSync').mockReturnValue(Buffer.from(''));

// windows-sign.cjs is a CommonJS module exporting a single async function.
const loadSign = async () => {
  const mod = await import('../../../scripts/windows-sign.cjs');
  return (mod.default ?? mod) as (file: string) => Promise<void>;
};

const ENV_KEYS = ['AZURE_TRUSTED_SIGNING_DLIB', 'AZURE_TRUSTED_SIGNING_METADATA', 'SIGNTOOL_PATH', 'CODESIGN_TIMESTAMP_URL'];

describe('windows-sign hook', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
    execFileSyncSpy.mockReset();
    execFileSyncSpy.mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    execFileSyncSpy.mockRestore();
  });

  it('throws when AZURE_TRUSTED_SIGNING_DLIB is unset', async () => {
    process.env.AZURE_TRUSTED_SIGNING_METADATA = '/tmp/metadata.json';
    const sign = await loadSign();
    await expect(sign('C:/app/foo.exe')).rejects.toThrow(/AZURE_TRUSTED_SIGNING_DLIB/);
    expect(execFileSyncSpy).not.toHaveBeenCalled();
  });

  it('throws when AZURE_TRUSTED_SIGNING_METADATA is unset', async () => {
    process.env.AZURE_TRUSTED_SIGNING_DLIB = '/tmp/dlib.dll';
    const sign = await loadSign();
    await expect(sign('C:/app/foo.exe')).rejects.toThrow(/AZURE_TRUSTED_SIGNING_METADATA/);
    expect(execFileSyncSpy).not.toHaveBeenCalled();
  });

  it('invokes signtool with the dlib, metadata, and file using defaults', async () => {
    process.env.AZURE_TRUSTED_SIGNING_DLIB = '/tmp/dlib.dll';
    process.env.AZURE_TRUSTED_SIGNING_METADATA = '/tmp/metadata.json';
    const sign = await loadSign();
    await sign('C:/app/foo.exe');
    expect(execFileSyncSpy).toHaveBeenCalledTimes(1);
    const [tool, args] = execFileSyncSpy.mock.calls[0];
    expect(tool).toBe('signtool.exe');
    expect(args).toEqual([
      'sign',
      '/v',
      '/fd',
      'sha256',
      '/tr',
      'http://timestamp.acs.microsoft.com',
      '/td',
      'sha256',
      '/dlib',
      '/tmp/dlib.dll',
      '/dmdf',
      '/tmp/metadata.json',
      '/d',
      'CoreSense',
      'C:/app/foo.exe',
    ]);
  });

  it('honors SIGNTOOL_PATH and CODESIGN_TIMESTAMP_URL overrides', async () => {
    process.env.AZURE_TRUSTED_SIGNING_DLIB = '/tmp/dlib.dll';
    process.env.AZURE_TRUSTED_SIGNING_METADATA = '/tmp/metadata.json';
    process.env.SIGNTOOL_PATH = 'C:/sdk/signtool.exe';
    process.env.CODESIGN_TIMESTAMP_URL = 'http://ts.example/';
    const sign = await loadSign();
    await sign('C:/app/foo.exe');
    const [tool, args] = execFileSyncSpy.mock.calls[0];
    expect(tool).toBe('C:/sdk/signtool.exe');
    expect(args).toContain('http://ts.example/');
  });
});
