import type { CliHistoryEntry } from './lib/persistence';

export interface CliReverseSearchProps {
  query: string;
  match: CliHistoryEntry | null;
  index: number;
  total: number;
}

export function CliReverseSearch(_props: CliReverseSearchProps) {
  return null; // fleshed out in Task 5
}
