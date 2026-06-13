import type { SearchCategory } from '../../../shared/types';

/** Radix multiple-ToggleGroup hands back the full next selection. Reject an
 *  empty selection (keep the previous one) so at least one category stays on. */
export function applyCategorySelection(next: string[], current: SearchCategory[]): SearchCategory[] {
  return next.length > 0 ? (next as SearchCategory[]) : current;
}
