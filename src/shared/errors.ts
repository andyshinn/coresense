/** Best-effort human-readable message from any thrown/rejected value. Safe for
 *  non-Error rejections, where `(err as Error).message` yields undefined (or
 *  throws on null): an Error or any object with a string `message` gives that
 *  message, a string is returned as-is, and anything else is JSON-encoded,
 *  falling back to String() when JSON can't represent it. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
