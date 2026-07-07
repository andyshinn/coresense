import { describe, expect, it } from 'vitest';
import { notificationCapabilities } from '../../../src/main/notifications/capabilities';

describe('notificationCapabilities', () => {
  it('darwin supports everything', () => {
    expect(notificationCapabilities('darwin')).toEqual({
      subtitle: true, groupId: true, remove: true, reply: true, actions: true,
    });
  });
  it('win32 supports all except subtitle', () => {
    expect(notificationCapabilities('win32')).toEqual({
      subtitle: false, groupId: true, remove: true, reply: true, actions: true,
    });
  });
  it('linux supports none of the platform-specific fields', () => {
    expect(notificationCapabilities('linux')).toEqual({
      subtitle: false, groupId: false, remove: false, reply: false, actions: false,
    });
  });
});
