import { app, Menu, type MenuItemConstructorOptions, shell } from 'electron';
import type { MenuAction } from '../shared/types';
import { emit } from './events/bus';

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
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: `${mod}+,`,
          click: send({ kind: 'openSettings' }),
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
        accelerator: `${mod}+Shift+A`,
        click: send({ kind: 'sendAdvert' }),
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
              accelerator: `${mod}+,`,
              click: send({ kind: 'openSettings' }),
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
        accelerator: `${mod}+K`,
        click: send({ kind: 'openPalette' }),
      },
      { type: 'separator' },
      {
        label: 'Toggle Left Nav',
        accelerator: `${mod}+\\`,
        click: send({ kind: 'toggleLeftNav' }),
      },
      {
        label: 'Toggle Right Rail',
        accelerator: `${mod}+.`,
        click: send({ kind: 'toggleRightRail' }),
      },
      { type: 'separator' },
      {
        label: 'Focus Channels',
        accelerator: `${mod}+1`,
        click: send({ kind: 'focusSection', section: 'channels' }),
      },
      {
        label: 'Focus Contacts',
        accelerator: `${mod}+2`,
        click: send({ kind: 'focusSection', section: 'contacts' }),
      },
      {
        label: 'Focus Tools',
        accelerator: `${mod}+3`,
        click: send({ kind: 'focusSection', section: 'tools' }),
      },
      {
        label: 'Focus Connection',
        accelerator: `${mod}+4`,
        click: send({ kind: 'focusSection', section: 'connection' }),
      },
      { type: 'separator' },
      {
        label: 'Cycle Theme',
        click: send({ kind: 'cycleTheme' }),
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
        label: 'Previous Pinned',
        accelerator: `${mod}+[`,
        click: send({ kind: 'cyclePinned', direction: 'prev' }),
      },
      {
        label: 'Next Pinned',
        accelerator: `${mod}+]`,
        click: send({ kind: 'cyclePinned', direction: 'next' }),
      },
      { type: 'separator' },
      {
        label: 'Pin / Unpin Current',
        accelerator: `${mod}+D`,
        click: send({ kind: 'pinToggle' }),
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
    ],
  });

  return Menu.buildFromTemplate(template);
}
