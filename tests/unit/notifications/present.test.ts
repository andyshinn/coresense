import { beforeEach, describe, expect, it, vi } from 'vitest';

const shown: Array<Record<string, unknown>> = [];
const removedGroups: string[] = [];
const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};

vi.mock('electron', () => {
  class FakeNotification {
    static isSupported() {
      return true;
    }
    static removeGroup(g: string) {
      removedGroups.push(g);
    }
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
    }
    on(event: string, cb: (...a: unknown[]) => void) {
      if (!handlers[event]) {
        handlers[event] = [];
      }
      handlers[event].push(cb);
      return this;
    }
    show() {
      shown.push(this.opts);
    }
  }
  return { Notification: FakeNotification };
});

import { notificationCapabilities } from '../../../src/main/notifications/capabilities';
import { electronPresenter } from '../../../src/main/notifications/present';

beforeEach(() => {
  shown.length = 0;
  removedGroups.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('electronPresenter', () => {
  it('macOS: maps subtitle, groupId, hasReply, and actions', () => {
    const focusWindow = vi.fn();
    const p = electronPresenter({ caps: notificationCapabilities('darwin'), focusWindow });
    const onClick = vi.fn();
    p.show({
      id: 'msg:1',
      groupId: 'ch:a',
      title: 'T',
      subtitle: 'Alice',
      body: 'hi',
      silent: false,
      reply: true,
      actions: ['Mark as read', 'Mute'],
      onClick,
    });
    expect(shown[0]).toMatchObject({
      id: 'msg:1',
      groupId: 'ch:a',
      title: 'T',
      subtitle: 'Alice',
      body: 'hi',
      silent: false,
      hasReply: true,
      actions: [
        { type: 'button', text: 'Mark as read' },
        { type: 'button', text: 'Mute' },
      ],
    });
    handlers.click[0]();
    expect(focusWindow).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
  });

  it('Linux: drops subtitle, groupId, hasReply, actions', () => {
    const p = electronPresenter({ caps: notificationCapabilities('linux'), focusWindow: vi.fn() });
    p.show({ groupId: 'ch:a', title: 'T', subtitle: 'Alice', body: 'hi', silent: true, reply: true, actions: ['Mute'] });
    expect(shown[0].subtitle).toBeUndefined();
    expect(shown[0].groupId).toBeUndefined();
    expect(shown[0].hasReply).toBeUndefined();
    expect(shown[0].actions).toBeUndefined();
  });

  it('clearGroup calls removeGroup where supported and no-ops otherwise', () => {
    electronPresenter({ caps: notificationCapabilities('darwin'), focusWindow: vi.fn() }).clearGroup('ch:a');
    expect(removedGroups).toEqual(['ch:a']);
    removedGroups.length = 0;
    electronPresenter({ caps: notificationCapabilities('linux'), focusWindow: vi.fn() }).clearGroup('ch:a');
    expect(removedGroups).toEqual([]);
  });
});
