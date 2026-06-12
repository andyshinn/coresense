import type { Buffer } from 'node:buffer';

/** The controlled slice of ProtocolSession a feature module may touch. Module
 *  singletons the legacy branches already import (stateHolder, emit,
 *  adminSessions, discoveredStore) are imported directly, not threaded here. */
export interface FeatureContext {
  /** Write a raw companion frame to the radio. */
  writeFrame(frame: Buffer): Promise<void>;
  /** Send a frame and await its reply. With `expect`, resolves the next inbound
   *  frame whose code === expect (a typed GET reply). Without `expect`, awaits
   *  the next RESP_OK/RESP_ERR and rejects with ProtocolError on RESP_ERR. */
  request(frame: Buffer, opts?: { expect?: number; timeoutMs?: number }): Promise<Buffer>;
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
