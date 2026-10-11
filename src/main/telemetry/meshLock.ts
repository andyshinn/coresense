// Radio-wide mesh-request lock.
//
// The companion firmware keeps ONE pending mesh request per radio:
// `clearPendingReqs()` (companion_radio/MyMesh.h) runs on every login, status,
// telemetry, binary-request and path-discovery send, so a second request
// silently kills the reply the first is still waiting for — which the app then
// records as a timeout that was really its own doing. So the awaited requests
// take turns: telemetry, and the admin routes the user waits on (login, ACL,
// neighbours, owner, CLI). The loser of a race gets 409 `radio_busy` rather
// than a queue slot — the UI disables those buttons while telemetry holds the
// lock, so a 409 means a race, not a normal flow.
//
// Not covered: the fire-and-forget status request (it answers through a WS
// push with nothing to hold the lock across) and the library's own background
// traffic. CLI and trace are covered although firmware doesn't clear the
// pending slot for them: through meshcore-ts 0.8.x every RESP_SENT is offered
// to the admin FIFO first, so a CLI send or a trace racing a telemetry request
// can swap their RESP_SENTs (a swapped trace resolves telemetry's waiter with
// its TRACE_DATA and fails with "superseded").

export type MeshLockOwner = 'telemetry' | 'login' | 'acl' | 'neighbours' | 'owner' | 'cli' | 'trace';

export interface MeshLockHolder {
  owner: MeshLockOwner;
  /** Bare 64-hex key of the node the request went to; null when not known. */
  nodeKey: string | null;
  since: number;
}

let held: (MeshLockHolder & { token: number }) | null = null;
let nextToken = 1;

/** Take the lock, or return null when someone else holds it. The returned
 *  release is idempotent and only ever frees the acquisition it came from, so
 *  a late release after a reset can't free a newer holder. */
export function tryAcquireMeshLock(owner: MeshLockOwner, nodeKey: string | null = null): (() => void) | null {
  if (held) return null;
  const token = nextToken++;
  held = { owner, nodeKey, since: Date.now(), token };
  return () => {
    if (held?.token === token) held = null;
  };
}

/** Who holds the lock right now, or null. */
export function meshLockHolder(): MeshLockHolder | null {
  if (!held) return null;
  const { token: _token, ...holder } = held;
  return holder;
}

/** Run `fn` under the lock. Resolves `{ busy }` without running it when the
 *  lock is held; otherwise `fn`'s value, releasing however `fn` settles. */
export async function withMeshLock<T>(
  owner: MeshLockOwner,
  nodeKey: string | null,
  fn: () => Promise<T>,
): Promise<{ busy: MeshLockHolder } | { busy: null; value: T }> {
  const release = tryAcquireMeshLock(owner, nodeKey);
  if (!release) return { busy: meshLockHolder() as MeshLockHolder };
  try {
    return { busy: null, value: await fn() };
  } finally {
    release();
  }
}

/** The 409 body for a request refused because the lock is held. The message is
 *  the hint the UI shows on the disabled buttons while telemetry holds it. */
export function radioBusyBody(holder: MeshLockHolder): { error: string; code: 'radio_busy'; owner: MeshLockOwner } {
  return {
    error: holder.owner === 'telemetry' ? 'Waiting for telemetry request' : 'Waiting for another mesh request',
    code: 'radio_busy',
    owner: holder.owner,
  };
}

/** Test seam: drop any holder. */
export function resetMeshLock(): void {
  held = null;
}
