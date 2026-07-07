import { Notification } from 'electron';
import type { Capabilities } from './capabilities';

export interface NotificationSpec {
  id?: string;
  groupId?: string;
  title: string;
  subtitle?: string;
  body: string;
  silent: boolean;
  reply?: boolean;
  replyPlaceholder?: string;
  actions?: string[]; // button labels, in order
  onClick?(): void;
  onReply?(text: string): void;
  onAction?(index: number): void;
}

export interface NotificationPresenter {
  isSupported(): boolean;
  show(spec: NotificationSpec): void;
  clearGroup(groupId: string): void;
}

// The only Electron-Notification consumer besides index.ts. Maps a
// platform-neutral spec onto the constructor, gating each field on the
// capability matrix so unsupported fields are simply omitted.
export function electronPresenter(deps: { caps: Capabilities; focusWindow(): void }): NotificationPresenter {
  const { caps, focusWindow } = deps;
  return {
    isSupported: () => Notification.isSupported(),
    show(spec) {
      const opts: Electron.NotificationConstructorOptions = {
        title: spec.title,
        body: spec.body,
        silent: spec.silent,
      };
      if (spec.id) opts.id = spec.id;
      if (caps.groupId && spec.groupId) opts.groupId = spec.groupId;
      if (caps.subtitle && spec.subtitle) opts.subtitle = spec.subtitle;
      if (caps.reply && spec.reply) {
        opts.hasReply = true;
        if (spec.replyPlaceholder) opts.replyPlaceholder = spec.replyPlaceholder;
      }
      if (caps.actions && spec.actions && spec.actions.length > 0) {
        opts.actions = spec.actions.map((text) => ({ type: 'button', text }));
      }
      const n = new Notification(opts);
      n.on('click', () => {
        focusWindow();
        spec.onClick?.();
      });
      // Electron's reply/action events differ across versions: older builds pass
      // (event, reply)/(event, index); newer builds expose the value on the event
      // object. The optional 2nd param typechecks against either overload and the
      // body handles both runtime shapes.
      n.on('reply', (_event: unknown, reply?: string) => {
        const details = _event as { reply?: string } | undefined;
        spec.onReply?.(reply ?? details?.reply ?? '');
      });
      n.on('action', (_event: unknown, index?: number) => {
        const details = _event as { actionIndex?: number } | undefined;
        spec.onAction?.(index ?? (typeof _event === 'number' ? _event : details?.actionIndex) ?? 0);
      });
      n.show();
    },
    clearGroup(groupId) {
      if (caps.remove) Notification.removeGroup(groupId);
    },
  };
}
