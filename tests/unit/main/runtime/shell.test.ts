import { beforeEach, describe, expect, it, vi } from 'vitest';

const shell = vi.hoisted(() => ({ openPath: vi.fn(), openExternal: vi.fn() }));
const warn = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({ shell }));
vi.mock('../../../../src/main/log', () => ({ log: { warn } }));

import { openExternalIfWeb, revealPath } from '../../../../src/main/runtime/shell';

beforeEach(() => {
  shell.openPath.mockReset();
  shell.openExternal.mockReset();
  warn.mockReset();
});

describe('revealPath', () => {
  // shell.openPath resolves with an error string instead of rejecting, so the
  // old `.catch(...)` never saw a failure.
  it('logs the error string openPath resolves with', async () => {
    shell.openPath.mockResolvedValue('Failed to open path');
    await revealPath('/no/such/dir');
    expect(warn).toHaveBeenCalledWith('openPath failed for /no/such/dir: Failed to open path');
  });

  it('stays quiet on success', async () => {
    shell.openPath.mockResolvedValue('');
    await revealPath('/logs');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs instead of rejecting when openPath rejects', async () => {
    shell.openPath.mockRejectedValue(new Error('boom'));
    await expect(revealPath('/logs')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('openPath failed for /logs: boom');
  });
});

describe('openExternalIfWeb', () => {
  it('opens only http(s) URLs', () => {
    shell.openExternal.mockResolvedValue(undefined);
    openExternalIfWeb('https://example.com');
    openExternalIfWeb('http://example.com');
    openExternalIfWeb('file:///etc/passwd');
    openExternalIfWeb('javascript:alert(1)');
    expect(shell.openExternal.mock.calls).toEqual([['https://example.com'], ['http://example.com']]);
  });

  it('logs a rejected open instead of leaving it unhandled', async () => {
    shell.openExternal.mockRejectedValue(new Error('no handler'));
    openExternalIfWeb('https://example.com');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('openExternal failed: no handler'));
  });
});
