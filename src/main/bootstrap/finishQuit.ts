import { withTimeout } from '../util/async';

export interface FinishQuitDeps {
  shutdown: () => Promise<void>;
  /** Upper bound on the shutdown, so one hung close or flush can't leave a
   *  quit (or a relaunch, which runs through the same quit) never finishing. */
  shutdownTimeoutMs: number;
  onShutdownError: (err: unknown) => void;
  /** Resolves once buffered log lines are on disk. Must never reject. */
  flushLog: () => Promise<void>;
  /** Upper bound on the log flush, so a stalled disk can't hang the quit. */
  flushTimeoutMs: number;
  exit: () => void;
}

/**
 * The tail of the before-quit handler: run the shutdown, log its failure, flush
 * the log file, then exit. The flush comes last so the shutdown's own warnings
 * (e.g. a transport timeout) reach the log file before the process goes away,
 * and it is time-bounded because exit used to never depend on log I/O. flushLog
 * never rejects, so the only rejection swallowed after it is the timeout. Exit
 * always runs, whatever the shutdown did: a shutdown still pending after
 * shutdownTimeoutMs is reported through onShutdownError and abandoned.
 */
export function finishQuit(deps: FinishQuitDeps): Promise<void> {
  return withTimeout(deps.shutdown(), deps.shutdownTimeoutMs, 'shutdown')
    .catch(deps.onShutdownError)
    .then(() => withTimeout(deps.flushLog(), deps.flushTimeoutMs, 'log flush').catch(() => {}))
    .finally(deps.exit);
}
