/** Settle with `p`, or reject with `${label} timed out after ${ms}ms` if it
 *  hasn't settled by then. The timer is cleared either way; `p` itself is not
 *  cancelled, so a late settle is simply ignored. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
