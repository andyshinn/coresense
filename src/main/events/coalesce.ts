export interface Coalescer {
  /** Signal that the underlying state changed and `run` should happen. */
  schedule(): void;
  /** Run a pending trailing pass now. Resolves once the state is settled. */
  flush(): Promise<void>;
  /** Drop a pending trailing pass without running it. */
  cancel(): void;
}

/** Collapse a burst of change signals into a bounded number of runs.
 *
 *  The first signal runs `run` immediately so the UI reacts without waiting;
 *  every signal arriving during the following `intervalMs` is collapsed into a
 *  single trailing run. That makes the run count proportional to how long the
 *  burst lasts, not to how many signals it contained — which is the difference
 *  between O(N) and O(1) emits for a contact sync that fires one event per
 *  contact. */
export function coalesce(run: () => void, intervalMs: number): Coalescer {
  let timer: NodeJS.Timeout | null = null;
  let pending = false;

  const fire = () => {
    timer = null;
    if (!pending) return;
    pending = false;
    run();
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
        run();
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
        run();
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
