import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

// Dev (`pnpm start`) and an installed build both report productName "CoreSense",
// so without this they share one userData folder — dev runs would read and
// corrupt real settings, messages.db, and the API key. Redirect all writable
// state into a sibling "CoreSenseDev" folder when unpackaged.
//
// Must run before anything calls app.getPath('userData'), and before the
// `ready` event (sessionData can only be moved pre-ready). Imported first in
// index.ts so this side effect happens before any other main-process code.
if (!app.isPackaged) {
  // CORESENSE_USER_DATA lets you run isolated profiles, e.g. a second radio.
  const devRoot = process.env.CORESENSE_USER_DATA ?? join(app.getPath('appData'), 'CoreSenseDev');
  const sessionDir = join(devRoot, 'session');
  mkdirSync(sessionDir, { recursive: true }); // also creates devRoot; setPath throws if missing
  app.setPath('userData', devRoot);
  app.setPath('sessionData', sessionDir);
}
