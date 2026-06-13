import type { AppSettings } from '../types';

/** Whether a "discovered contact" native notification should fire, given the
 *  notification policy and whether the main window is currently focused.
 *  Honors the per-kind toggle and the shared "suppress while focused" rule. */
export function shouldFireDiscovered(policy: AppSettings['notifications'], windowFocused: boolean): boolean {
  if (!policy.discoveredContact) return false;
  if (policy.suppressWhenFocused && windowFocused) return false;
  return true;
}
