import { Hono } from 'hono';
import { onApiError } from '../errors';
import { userCommandGate } from '../middleware/userCommandGate';
import { registerTileRoutes } from '../tiles';
import { type RoutesDeps, registerAppRoutes } from './app';
import { registerBlockRoutes } from './blocks';
import { registerChannelRoutes } from './channels';
import { registerContactRoutes } from './contacts';
import { registerDeviceRoutes } from './device';
import { registerMacroRoutes } from './macros';
import { registerMapRoutes } from './map';
import { registerMessageRoutes } from './messages';
import { registerRepeaterRoutes } from './repeater';
import { registerSettingsRoutes } from './settings';
import { registerStateRoutes } from './state';
import { registerTelemetryRoutes } from './telemetry';
import { registerTransportRoutes } from './transport';

export type { RoutesDeps } from './app';

/** The /api sub-app: one register* module per resource. */
export function createRoutes(deps: RoutesDeps) {
  const api = new Hono();
  // Installed here, not only on the server app: a sub-app's own handler is the
  // one that sees its routes' throws, and the route tests drive this app alone.
  api.onError(onApiError);
  // Lets My Node's poll step aside for a user command (middleware/userCommandGate.ts).
  api.use('*', userCommandGate);

  registerTileRoutes(api);
  registerAppRoutes(api, deps);
  registerStateRoutes(api, deps);
  registerSettingsRoutes(api, deps);
  registerBlockRoutes(api);
  registerDeviceRoutes(api);
  registerMapRoutes(api);
  registerChannelRoutes(api);
  registerContactRoutes(api);
  registerMessageRoutes(api);
  registerRepeaterRoutes(api);
  registerTransportRoutes(api);
  registerMacroRoutes(api);
  registerTelemetryRoutes(api);

  return api;
}
