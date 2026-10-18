import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/renderer/lib/logger', () => ({ log: { error: vi.fn() } }));

import { copyToClipboard } from '../../../../src/renderer/lib/clipboard';
import { log } from '../../../../src/renderer/lib/logger';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('writes the text and calls onDone on success', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onDone = vi.fn();
    copyToClipboard('abc', onDone);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('logs a rejected write and skips onDone', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
    const onDone = vi.fn();
    copyToClipboard('abc', onDone);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith('Clipboard write failed', expect.any(Error)));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('logs when the clipboard API is unavailable', () => {
    vi.stubGlobal('navigator', {});
    copyToClipboard('abc');
    expect(log.error).toHaveBeenCalledOnce();
  });
});
