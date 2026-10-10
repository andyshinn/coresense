// Channel names for the preload <-> main IPC. The preload (src/preload.ts) and
// the main process (src/main/index.ts) must agree on these byte for byte.
export const IPC = {
  /** sendSync → the shared API key (string). */
  getApiKey: 'coresense:get-api-key',
  /** sendSync → the bound HTTP server port, or null once the server is gone. */
  getHttpPort: 'coresense:get-http-port',
  /** send, no reply: open the logs folder in the OS file manager. */
  revealLogs: 'coresense:logs:reveal',
} as const;

/** Synchronous reply payload for each `sendSync` channel. */
export interface IpcSyncReplies {
  [IPC.getApiKey]: string;
  [IPC.getHttpPort]: number | null;
}
