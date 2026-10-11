import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/lib/api', () => ({
  api: { requestTelemetry: vi.fn() },
}));
vi.mock('../../../../../src/renderer/lib/notify', () => import('../../../../support/notifyMock'));

import { buildActionItems } from '../../../../../src/renderer/features/command-palette/items/actions';
import { api } from '../../../../../src/renderer/lib/api';
import { useStore } from '../../../../../src/renderer/lib/store';
import type { SavedRequestDto } from '../../../../../src/shared/telemetry/types';
import type { Contact } from '../../../../../src/shared/types';
import { notify } from '../../../../support/notifyMock';

const client = { baseUrl: 'http://x', apiKey: 'k' };
const KEY = `c:${'cd'.repeat(32)}`;

function contact(kind: Contact['kind']): Contact {
  return { key: KEY, name: 'Hilltop', kind, publicKeyHex: 'cd'.repeat(32) } as Contact;
}

function telemetryAction(activeContact: Contact | undefined, setActiveKey = vi.fn(), close = vi.fn()) {
  const items = buildActionItems({
    client,
    close,
    cycleThemePref: () => {},
    toggleLeftNav: () => {},
    toggleRightRail: () => {},
    togglePin: () => {},
    setActiveKey,
    setAddChannelOpen: () => {},
    markAllRead: () => {},
    markAllReadGlobal: () => {},
    clearPackets: () => {},
    lastDevice: null,
    transportState: 'connected' as const,
    owner: null,
    packetCount: 0,
    activeKey: activeContact?.key ?? 'tool:packetlog',
    activeContact,
  });
  return items.find((i) => i.id === 'action:repeaterTelemetry');
}

const saved = (over: Partial<SavedRequestDto>) => ({ id: 'r1', outcome: 'ok', ...over }) as SavedRequestDto;

describe('command palette: request telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.getState().setRepeaterAdminTab(null);
  });

  it('is offered for repeaters and sensors only', () => {
    expect(telemetryAction(contact('repeater'))?.label).toBe('Request repeater telemetry');
    expect(telemetryAction(contact('sensor'))?.label).toBe('Request sensor telemetry');
    expect(telemetryAction(contact('chat'))).toBeUndefined();
    expect(telemetryAction(undefined)).toBeUndefined();
  });

  it('opens the Telemetry tab, calls the request route and toasts "Telemetry saved"', async () => {
    vi.mocked(api.requestTelemetry).mockResolvedValueOnce(saved({ outcome: 'ok' }));
    const setActiveKey = vi.fn();
    const close = vi.fn();
    telemetryAction(contact('repeater'), setActiveKey, close)?.run();
    expect(useStore.getState().repeaterAdminTab).toBe('telemetry');
    expect(setActiveKey).toHaveBeenCalledWith(KEY);
    expect(close).toHaveBeenCalled();
    expect(api.requestTelemetry).toHaveBeenCalledWith(client, KEY);
    await vi.waitFor(() => expect(notify.success).toHaveBeenCalledWith('Telemetry saved'));
  });

  it('reports a saved timeout as a failure with its reason', async () => {
    vi.mocked(api.requestTelemetry).mockResolvedValueOnce(saved({ outcome: 'timeout', error: 'no reply after 15 s' }));
    telemetryAction(contact('repeater'))?.run();
    await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith('Telemetry request failed: no reply after 15 s'));
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('falls back to the outcome when a failed request has no error text', async () => {
    vi.mocked(api.requestTelemetry).mockResolvedValueOnce(saved({ outcome: 'error' }));
    telemetryAction(contact('sensor'))?.run();
    await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith('Telemetry request failed: error'));
  });

  it('reports a rejected POST (radio busy, offline) as a failure', async () => {
    const err = new Error('radio busy');
    vi.mocked(api.requestTelemetry).mockRejectedValueOnce(err);
    telemetryAction(contact('repeater'))?.run();
    await vi.waitFor(() => expect(notify.failure).toHaveBeenCalledWith('Telemetry request', err));
  });
});
