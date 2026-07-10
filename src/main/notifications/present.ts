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

/** Upper bound on retained notifications, so a long session can't grow unbounded. */
const MAX_LIVE = 200;

// The only Electron-Notification consumer besides index.ts. Maps a
// platform-neutral spec onto the constructor, gating each field on the
// capability matrix so unsupported fields are simply omitted.
export function electronPresenter(deps: {
  caps: Capabilities;
  focusWindow(): void;
  debug?(message: string): void;
}): NotificationPresenter {
  const { caps, focusWindow } = deps;
  const debug = deps.debug ?? (() => {});
  // Electron garbage-collects a Notification once it is unreachable from JS, and
  // a collected notification never fires its click/reply/action events — the
  // native banner still shows and macOS still activates the app on click, which
  // makes it look like "the click does nothing". Hold a reference from show()
  // until the notification is closed or acted upon.
  const live = new Map<string, { n: Electron.Notification; groupId?: string }>();
  let anon = 0;

  function retain(key: string, n: Electron.Notification, groupId?: string): void {
    live.set(key, { n, groupId });
    if (live.size > MAX_LIVE) {
      const oldest = live.keys().next().value;
      if (oldest !== undefined) live.delete(oldest);
    }
  }

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
      const key = spec.id ?? `anon:${anon++}`;
      const n = new Notification(opts);
      n.on('click', () => {
        debug(`click id=${key}`);
        live.delete(key);
        focusWindow();
        spec.onClick?.();
      });
      n.on('close', () => {
        live.delete(key);
      });
      // Electron's reply/action events differ across versions: older builds pass
      // (event, reply)/(event, index); newer builds expose the value on the event
      // object. The optional 2nd param typechecks against either overload and the
      // body handles both runtime shapes.
      n.on('reply', (_event: unknown, reply?: string) => {
        const details = _event as { reply?: string } | undefined;
        const text = reply ?? details?.reply ?? '';
        debug(`reply id=${key} chars=${text.length}`);
        live.delete(key);
        spec.onReply?.(text);
      });
      n.on('action', (_event: unknown, index?: number) => {
        const details = _event as { actionIndex?: number } | undefined;
        const idx = index ?? (typeof _event === 'number' ? _event : details?.actionIndex) ?? 0;
        debug(`action id=${key} index=${idx}`);
        live.delete(key);
        spec.onAction?.(idx);
      });
      retain(key, n, spec.groupId);
      debug(
        `show id=${key} group=${spec.groupId ?? '-'} silent=${spec.silent} hasReply=${opts.hasReply ?? false} actions=${opts.actions?.length ?? 0}`,
      );
      n.show();
    },
    clearGroup(groupId) {
      for (const [key, entry] of live) {
        if (entry.groupId === groupId) live.delete(key);
      }
      if (!caps.remove) return;
      debug(`clearGroup ${groupId}`);
      Notification.removeGroup(groupId);
    },
  };
}
