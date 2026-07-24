import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { type ApiClient, api } from '@/lib/api';
import { notify } from '@/lib/notify';
import { expandMacroReply, targetToContext } from '@/panels/macros/lib/inchat';
import type { MacroTemplate } from '../../../../../src/shared/macros/types';

describe('targetToContext', () => {
  it('maps a channel key to channelKey', () => {
    expect(targetToContext('ch:testing')).toEqual({ channelKey: 'ch:testing' });
  });

  it('maps a contact key to contactKey', () => {
    expect(targetToContext('c:abc123')).toEqual({ contactKey: 'c:abc123' });
  });

  it('returns an empty context for an unknown or missing key', () => {
    expect(targetToContext(undefined)).toEqual({});
    expect(targetToContext('tool:macros')).toEqual({});
  });
});

const client: ApiClient = { baseUrl: 'http://x', apiKey: 'k' };
const macro: MacroTemplate = {
  id: 'a',
  name: 'Signal report',
  template: '{{ snr }} snr',
  scope: 'global',
  createdAt: 0,
  updatedAt: 0,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(notify.error).mockClear();
});

describe('expandMacroReply', () => {
  it('renders the macro in reply mode against the message and returns the text', async () => {
    const spy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'rendered reply' });
    await expect(expandMacroReply(client, macro, { id: 'msg1' })).resolves.toBe('rendered reply');
    expect(spy.mock.calls[0][1]).toMatchObject({
      macroId: 'a',
      mode: 'reply',
      messageId: 'msg1',
      placeholder: '?',
    });
  });

  it('returns null and toasts when the render fails', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({
      ok: false,
      error: { kind: 'unknown-variable', message: 'no such variable' },
    });
    await expect(expandMacroReply(client, macro, { id: 'msg1' })).resolves.toBeNull();
    expect(notify.error).toHaveBeenCalledTimes(1);
  });

  it('returns null without calling the API when there is no client', async () => {
    const spy = vi.spyOn(api, 'renderMacro');
    await expect(expandMacroReply(null, macro, { id: 'msg1' })).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null and toasts when the API call throws (network/transport error)', async () => {
    vi.spyOn(api, 'renderMacro').mockRejectedValue(new Error('network down'));
    await expect(expandMacroReply(client, macro, { id: 'msg1' })).resolves.toBeNull();
    expect(notify.error).toHaveBeenCalledTimes(1);
  });
});
