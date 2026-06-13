import type { Buffer } from 'node:buffer';

/** The controlled slice of ProtocolSession a feature module may touch. Other
 *  shared singletons (stateHolder, emit, adminSessions, discoveredStore) are
 *  imported directly by the feature modules, not threaded through here. */
export interface FeatureContext {
  /** Write a raw companion frame to the radio. */
  writeFrame(frame: Buffer): Promise<void>;
  /** Send a frame and await its reply. With `expect`, resolves the next inbound
   *  frame whose code === expect (a typed GET reply). Without `expect`, awaits
   *  the next RESP_OK/RESP_ERR and rejects with ProtocolError on RESP_ERR. */
  request(frame: Buffer, opts?: { expect?: number; timeoutMs?: number }): Promise<Buffer>;
  /** Send a frame and await either its typed reply (code === expect) OR a
   *  RESP_ERR — for GETs that legitimately answer "not found" (e.g. no cached
   *  advert path). Resolves the typed frame, or null on RESP_ERR. The RESP_ERR
   *  is consumed via the shared ack FIFO so it can't be mistaken for a rejected
   *  DM send. Rejects on timeout / write failure / disconnect. `expect` must be
   *  a typed reply code, not RESP_OK/RESP_ERR. */
  requestOrNull(frame: Buffer, expect: number, timeoutMs?: number): Promise<Buffer | null>;
}

/** A protocol feature: owns the inbound wire codes it reacts to. Feature
 *  modules also export their own encode* / decode* functions and session-facing
 *  functions; those are wired explicitly by ProtocolSession. */
export interface Feature {
  /** Inbound RESP_* / PUSH_* codes this feature decodes & reacts to. */
  readonly handles: readonly number[];
  /** React to an inbound frame whose code is one of `handles`. */
  handle(code: number, frame: Buffer, ctx: FeatureContext): void;
}
