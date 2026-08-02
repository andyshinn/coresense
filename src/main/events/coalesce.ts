import { child } from '../log';

const log = child('coalesce');

export interface Coalescer {
  /** Signal that the underlying state changed and `run` should happen. */
  schedule(): void;
  /** Run a pending trailing pass now. Resolves once the state is settled. */
  flush(): Promise<void>;
  /** Drop a pending trailing pass without running it. */
  cancel(): void;
}

/** Collapse a burst of change signals into a bounded rate of runs.
 *
 *  The first signal runs `run` immediately so the UI reacts without waiting;
 *  every signal arriving during the following `intervalMs` is collapsed into a
 *  single trailing run. So the run count is roughly
 *
 *      runs ≈ burst_duration / intervalMs
 *
 *  It is decoupled from how many signals the burst contained, but NOT constant:
 *  a contact sync's duration grows with the contact count, so the runs still
 *  grow with N — just divided by the interval instead of one per signal.
 *  Measured over a real ~15s 300-contact sync: 300 signals produced 128 runs at
 *  a 120ms interval and 17 at 1s. Pick the interval against the expected burst
 *  DURATION; making the per-run work cheaper does not reduce the count. */
export function coalesce(run: () => void, intervalMs: number): Coalescer {
  let timer: NodeJS.Timeout | null = null;
  let pending = false;

  // A coalesced run() executes deferred work (a DB rebuild, a bus broadcast)
  // that can throw. The main process installs no uncaughtException handler, so
  // a throw escaping the trailing setTimeout below would terminate the app.
  // Contain failures and keep the cadence alive; the next signal recovers.
  const safeRun = () => {
    try {
      run();
    } catch (err) {
      log.warn(`coalesced run failed: ${(err as Error).message}`);
    }
  };

  const fire = () => {
    timer = null;
    if (!pending) return;
    pending = false;
    safeRun();
    // Something changed during this cycle, so open another window: a long
    // burst keeps producing one run per interval rather than going quiet.
    arm();
  };

  const arm = () => {
    timer = setTimeout(fire, intervalMs);
    // Don't let a pending coalesce window keep the process alive at shutdown.
    timer.unref?.();
  };

  return {
    schedule() {
      if (timer === null) {
        safeRun();
        arm();
        return;
      }
      pending = true;
    },
    async flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending) {
        pending = false;
        safeRun();
      }
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = false;
    },
  };
}
