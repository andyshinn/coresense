import { withTimeout } from '../util/async';

export interface FinishQuitDeps {
  shutdown: () => Promise<void>;
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
 * always runs, whatever the shutdown did.
 */
export function finishQuit(deps: FinishQuitDeps): Promise<void> {
  return deps
    .shutdown()
    .catch(deps.onShutdownError)
    .then(() => withTimeout(deps.flushLog(), deps.flushTimeoutMs, 'log flush').catch(() => {}))
    .finally(deps.exit);
}
