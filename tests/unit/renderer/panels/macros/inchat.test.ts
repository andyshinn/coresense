import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/notify', () => import('../../../../support/notifyMock'));

import { type ApiClient, api } from '@/lib/api';
import { expandMacro, expandMacroReply, renderMacroSafe, targetToContext } from '@/panels/macros/lib/inchat';
import type { MacroTemplate } from '../../../../../src/shared/macros/types';
import { notify, resetNotifyMock } from '../../../../support/notifyMock';

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
  resetNotifyMock();
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

describe('expandMacro', () => {
  it('renders the macro in send mode bound to the target conversation', async () => {
    const spy = vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: true, text: 'rendered send' });
    await expect(expandMacro(client, macro, 'ch:testing')).resolves.toBe('rendered send');
    expect(spy.mock.calls[0][1]).toMatchObject({ macroId: 'a', mode: 'send', channelKey: 'ch:testing', placeholder: '?' });
  });

  it('returns null and toasts when the render fails', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: false, error: { kind: 'render', message: 'boom' } });
    await expect(expandMacro(client, macro, 'c:abc')).resolves.toBeNull();
    expect(notify.error).toHaveBeenCalledWith('Couldn’t expand “Signal report”: boom');
  });

  // Regression: the send path had no try/catch, so a transport failure
  // rejected instead of toasting, and the composer popover never closed.
  it('returns null and toasts when the API call throws (network/transport error)', async () => {
    const err = new Error('network down');
    vi.spyOn(api, 'renderMacro').mockRejectedValue(err);
    await expect(expandMacro(client, macro, 'c:abc')).resolves.toBeNull();
    expect(notify.error).toHaveBeenCalledWith('Couldn’t expand “Signal report”: network down', err);
  });
});

describe('renderMacroSafe', () => {
  it('maps a template error to a failed outcome', async () => {
    vi.spyOn(api, 'renderMacro').mockResolvedValue({ ok: false, error: { kind: 'parse', message: 'bad tag' } });
    await expect(renderMacroSafe(client, 'a', { mode: 'send' })).resolves.toEqual({ ok: false, message: 'bad tag' });
  });

  it('maps a transport failure to a failed outcome instead of rejecting', async () => {
    const err = new Error('HTTP 500');
    vi.spyOn(api, 'renderMacro').mockRejectedValue(err);
    await expect(renderMacroSafe(client, 'a', { mode: 'reply', messageId: 'm' })).resolves.toEqual({
      ok: false,
      message: 'HTTP 500',
      cause: err,
    });
  });
});
