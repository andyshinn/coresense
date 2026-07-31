// Ranking one command against a query. Prefix › word-start › mid-substring ›
// subsequence › description hit; the empty query ties every command at 1 so the
// recency bonus (§2.3) dominates the browse list.
import type { CliCommand } from '../../../../../shared/repeater-cli/catalog';

export interface CliMatch {
  score: number;
  ranges: [number, number][];
}

export function matchCommand(query: string, cmd: CliCommand): CliMatch | null {
  if (!query) return { score: 1, ranges: [] };

  const name = cmd.name;
  const ln = name.toLowerCase();
  const lq = query.toLowerCase();
  const at = ln.indexOf(lq);

  if (at === 0) return { score: 1000 - name.length, ranges: [[0, lq.length]] };
  if (at > 0) {
    const wordStart = /[\s.-]/.test(name[at - 1]);
    return { score: (wordStart ? 700 : 450) - name.length, ranges: [[at, at + lq.length]] };
  }

  // Subsequence — "sr" → "set radio".
  const ranges: [number, number][] = [];
  let i = 0;
  for (let j = 0; j < ln.length && i < lq.length; j++) {
    if (ln[j] === lq[i]) {
      ranges.push([j, j + 1]);
      i++;
    }
  }
  if (i === lq.length) return { score: 300 - name.length, ranges: mergeRanges(ranges) };

  if (cmd.desc.toLowerCase().includes(lq)) return { score: 120 - name.length, ranges: [] };
  return null;
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of r) {
    const last = out[out.length - 1];
    if (last && last[1] === a) last[1] = b;
    else out.push([a, b]);
  }
  return out;
}

/** Longest shared case-insensitive prefix — what Tab fills in. Computed over
 *  NON-serialOnly items only (§2.2): one sunk serial-only command sharing no
 *  prefix would otherwise collapse the result to null and Tab would do nothing.
 *  Accepts CliSuggestion[] (its optional `serialOnly` matches). */
export function commonPrefix(items: { label: string; serialOnly?: true }[]): string | null {
  const usable = items.filter((i) => !i.serialOnly);
  if (usable.length === 0) return null;

  let pre = usable[0].label;
  for (const it of usable) {
    let i = 0;
    while (i < pre.length && i < it.label.length && pre[i].toLowerCase() === it.label[i].toLowerCase()) i++;
    pre = pre.slice(0, i);
    if (!pre) return null;
  }
  return pre;
}
