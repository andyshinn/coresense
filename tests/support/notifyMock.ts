import { type Mock, vi } from 'vitest';
import type { notify as realNotify } from '../../src/renderer/lib/notify';

// A stand-in for src/renderer/lib/notify. Install it with
//
//   vi.mock('@/lib/notify', () => import('../support/notifyMock'));
//
// and import `notify` from this module (not '@/lib/notify') to get the Mock
// types for assertions. Both resolve to the same module instance in a test
// file, so they are the same functions. Typed against the real `notify`, so a
// method added there (as `failure` was) fails to compile here until it is
// mocked, instead of being undefined at runtime in every test file.

export const notify: { [K in keyof typeof realNotify]: Mock<(typeof realNotify)[K]> } = {
  error: vi.fn(),
  failure: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
};

/** Reset every notify mock's calls and implementation. */
export function resetNotifyMock(): void {
  for (const fn of Object.values(notify)) fn.mockReset();
}
