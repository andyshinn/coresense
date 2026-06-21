import { app, BrowserWindow, Menu, type MenuItemConstructorOptions, shell } from 'electron';
import { accelFor, menuActionFor } from '../shared/shortcuts';
import type { MenuAction } from '../shared/types';
import { showAboutDialog } from './about';
import { emit } from './events/bus';
import { updatesController } from './updates/controller';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Cmd' : 'Ctrl';

function send(action: MenuAction): () => void {
  return () => emit.menuAction(action);
}

export function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        {
          label: 'Check for Updates…',
          click: () => {
            void updatesController().check();
          },
        },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: accelFor('settings'),
          click: send(menuActionFor('settings')),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'File',
    submenu: [
      {
        label: 'New Channel',
        accelerator: `${mod}+N`,
        click: send({ kind: 'newChannel' }),
      },
      {
        label: 'Add Contact',
        accelerator: `${mod}+Shift+N`,
        click: send({ kind: 'addContact' }),
      },
      { type: 'separator' },
      {
        label: 'Send Advert',
        accelerator: accelFor('sendAdvert'),
        click: send(menuActionFor('sendAdvert')),
      },
      {
        label: 'Reconnect Radio',
        accelerator: accelFor('reconnect'),
        click: send(menuActionFor('reconnect')),
      },
      {
        label: 'Toggle Repeat Mode',
        accelerator: accelFor('toggleRepeat'),
        click: send(menuActionFor('toggleRepeat')),
      },
      {
        label: 'Disconnect Radio',
        click: send({ kind: 'disconnect' }),
      },
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            {
              label: 'Settings…',
              accelerator: accelFor('settings'),
              click: send(menuActionFor('settings')),
            },
            { type: 'separator' },
            { role: 'quit' },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      {
        label: 'Command Palette…',
        accelerator: accelFor('commandPalette'),
        click: send(menuActionFor('commandPalette')),
      },
      { type: 'separator' },
      {
        label: 'Toggle Left Nav',
        accelerator: accelFor('toggleSidebar'),
        click: send(menuActionFor('toggleSidebar')),
      },
      {
        label: 'Toggle Right Rail',
        accelerator: accelFor('toggleRightRail'),
        click: send(menuActionFor('toggleRightRail')),
      },
      {
        label: 'Packet Log',
        accelerator: accelFor('packetLog'),
        click: send(menuActionFor('packetLog')),
      },
      { type: 'separator' },
      {
        label: 'Cycle Theme',
        accelerator: accelFor('toggleTheme'),
        click: send(menuActionFor('toggleTheme')),
      },
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  template.push({
    label: 'Navigate',
    submenu: [
      {
        label: 'Back',
        accelerator: isMac ? 'Cmd+Left' : 'Alt+Left',
        click: send({ kind: 'navigate', direction: 'back' }),
      },
      {
        label: 'Forward',
        accelerator: isMac ? 'Cmd+Right' : 'Alt+Right',
        click: send({ kind: 'navigate', direction: 'forward' }),
      },
      { type: 'separator' },
      {
        label: 'Previous Pinned',
        accelerator: accelFor('prevPinned'),
        click: send(menuActionFor('prevPinned')),
      },
      {
        label: 'Next Pinned',
        accelerator: accelFor('nextPinned'),
        click: send(menuActionFor('nextPinned')),
      },
      { type: 'separator' },
      {
        label: 'Pin / Unpin Current',
        accelerator: accelFor('pinCurrent'),
        click: send(menuActionFor('pinCurrent')),
      },
    ],
  });

  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? ([
            { type: 'separator' },
            { role: 'front' },
            { type: 'separator' },
            { role: 'window' },
          ] satisfies MenuItemConstructorOptions[])
        : ([{ role: 'close' }] satisfies MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    role: 'help',
    submenu: [
      {
        label: 'MeshCore Project',
        click: () => {
          void shell.openExternal('https://meshcore.co.uk');
        },
      },
      {
        label: 'Check for Updates…',
        click: () => {
          void updatesController().check();
        },
      },
      { type: 'separator' },
      // macOS users can still reach a native panel through the app menu's
      // standard "About" item (see applyAboutPanel); this Help entry is the
      // sole About surface on Windows where setAboutPanelOptions is a no-op,
      // and the Linux fallback when GTK doesn't render the native panel.
      {
        label: `About ${app.name}`,
        click: () => showAboutDialog(BrowserWindow.getFocusedWindow()),
      },
    ],
  });

  return Menu.buildFromTemplate(template);
}
