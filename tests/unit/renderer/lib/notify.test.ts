import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('../../../../src/renderer/lib/logger', () => ({ log: { error: vi.fn(), info: vi.fn() } }));
vi.mock('../../../../src/renderer/lib/store', () => ({
  useStore: { getState: () => ({ appSettings: { toasts: { enabled: true, durationSec: 4 } } }) },
}));

import { toast } from 'sonner';
import { log } from '../../../../src/renderer/lib/logger';
import { notify } from '../../../../src/renderer/lib/notify';

describe('notify.failure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('toasts and logs "<action> failed: <message>" with the original error', () => {
    const err = new Error('radio busy');
    notify.failure('Send', err);
    expect(log.error).toHaveBeenCalledWith('Send failed: radio busy', err);
    expect(toast.error).toHaveBeenCalledWith('Send failed: radio busy', { duration: 4000 });
  });

  it('handles a non-Error rejection', () => {
    notify.failure('Reboot', 'timeout');
    expect(toast.error).toHaveBeenCalledWith('Reboot failed: timeout', { duration: 4000 });
  });
});
