// Per-platform Electron Notification capability flags. Sourced from the
// Electron 42 docs platform tags: subtitle (macOS only), groupId/remove
// (macOS+Windows), reply/actions (macOS+Windows), nothing on Linux.
export interface Capabilities {
  subtitle: boolean;
  groupId: boolean;
  remove: boolean;
  reply: boolean;
  actions: boolean;
}

export function notificationCapabilities(platform: NodeJS.Platform): Capabilities {
  if (platform === 'darwin') {
    return { subtitle: true, groupId: true, remove: true, reply: true, actions: true };
  }
  if (platform === 'win32') {
    return { subtitle: false, groupId: true, remove: true, reply: true, actions: true };
  }
  return { subtitle: false, groupId: false, remove: false, reply: false, actions: false };
}
