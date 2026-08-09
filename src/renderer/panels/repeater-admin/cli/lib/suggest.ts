// Ranked suggestions over the catalog. One flat, already-sorted list; the
// palette (Phase 2) groups it for display. Apply/splice semantics are stated
// once (§2.3) and every call site — Tab, Enter, mouse click, ghost — uses
// applySuggestion so they can never drift apart.
import { CLI_COMMANDS, type CliCommand, type CliGroup } from '../../../../../shared/repeater-cli/catalog';
import { matchCommand } from './match';
import { type CliParse, parseCliLine, resolveCommand } from './parse';
import type { CliHistoryEntry } from './persistence';

export interface CliSuggestCtx {
  recent: string[]; // command names, most-recent first, max 5
  nodeValues: Record<string, string>; // cmd.key → last extracted get value
}

export interface CliSuggestion {
  id: string;
  label: string;
  desc: string;
  kind: 'command' | 'value' | 'preset' | 'current';
  cmd?: CliCommand;
  group?: CliGroup;
  ranges?: [number, number][];
  meta?: string;
  insert: string;
  replaceFrom: number;
  replaceAll?: boolean;
  serialOnly?: true;
  recent?: true;
}

export function suggest(text: string, caret: number, ctx: CliSuggestCtx): { parse: CliParse; items: CliSuggestion[] } {
  const parse = parseCliLine(text, caret);

  if (parse.mode === 'arg') {
    const cmd = parse.cmd;
    const arg = cmd.args?.[parse.argIndex];
    const q = parse.token.toLowerCase();
    const enumVals = arg?.enum ?? [];
    const nodeVal = cmd.key ? ctx.nodeValues[cmd.key] : undefined;
    const items: CliSuggestion[] = [];

    // 1. The value the node last reported — argIndex 0 only, not a dup of an enum.
    if (parse.argIndex === 0 && nodeVal && !enumVals.includes(nodeVal) && (!q || nodeVal.toLowerCase().startsWith(q))) {
      items.push({
        id: `n:${cmd.name}`,
        label: nodeVal,
        desc: 'Value on the node now',
        kind: 'current',
        meta: 'on node now',
        insert: nodeVal,
        replaceFrom: parse.start,
      });
    }
    // 2. Enum values, filtered by prefix, carrying their enumDesc.
    for (const v of enumVals) {
      if (q && !v.toLowerCase().startsWith(q)) continue;
      items.push({
        id: `e:${cmd.name}:${v}`,
        label: v,
        desc: arg?.enumDesc?.[v] ?? arg?.name ?? '',
        kind: 'value',
        insert: v,
        replaceFrom: parse.start,
        ...(nodeVal === v ? { meta: 'current' } : {}),
      });
    }
    // 3. Presets — value-prefix OR label-substring.
    for (const p of cmd.presets ?? []) {
      if (q && !p.value.toLowerCase().startsWith(q) && !p.label.toLowerCase().includes(q)) continue;
      items.push({
        id: `p:${cmd.name}:${p.value}`,
        label: p.value,
        desc: p.label,
        kind: 'preset',
        insert: p.value,
        replaceFrom: parse.start,
        ...(p.note ? { meta: p.note } : {}),
      });
    }
    return { parse, items };
  }

  // Command mode: score every command, apply the recency boost and serial-only
  // penalty, sort descending (stable → catalog order for ties).
  const token = parse.token.trim();
  const scored: { score: number; item: CliSuggestion }[] = [];
  for (const cmd of CLI_COMMANDS) {
    const m = matchCommand(token, cmd);
    if (!m) continue;
    const rIdx = ctx.recent.indexOf(cmd.name);
    const score = m.score + (rIdx >= 0 ? 260 - rIdx * 10 : 0) - (cmd.serialOnly ? 2000 : 0);
    scored.push({
      score,
      item: {
        id: `c:${cmd.name}`,
        label: cmd.name,
        desc: cmd.desc,
        kind: 'command',
        cmd,
        group: cmd.group,
        ranges: m.ranges,
        insert: cmd.name + (cmd.spec || cmd.args ? ' ' : ''),
        replaceFrom: 0,
        replaceAll: true,
        ...(cmd.serialOnly ? { serialOnly: true } : {}),
        ...(rIdx >= 0 && token === '' ? { recent: true } : {}),
      },
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { parse, items: scored.map((x) => x.item) };
}

export interface CliPaletteGroup {
  name: string | null;
  items: CliSuggestion[];
}

// The palette's display order — the SINGLE source of truth for BOTH rendering
// (CliPalette draws these groups) and keyboard navigation (the reducer steps
// through `orderedSuggestions`, the flattened form). One function is why ↑/↓
// move to the next VISUAL row instead of the next raw-ranked item: the raw
// `suggest()` list is scored flat and interleaves groups, while the palette
// clusters them, so navigating the raw list looked like it "jumped" between
// sections. Command mode: Recent first, then catalog groups in first-appearance
// (== best-member score) order, then serial-only sunk into one trailing group.
// Argument mode is a single ungrouped list. The result is a permutation of
// `items` — nothing is added or dropped — so navigation stays complete.
export function groupSuggestions(parse: CliParse, items: CliSuggestion[]): CliPaletteGroup[] {
  if (parse.mode === 'arg') return [{ name: null, items }];
  const recent = items.filter((i) => i.recent);
  const rest = items.filter((i) => !i.recent);
  const avail = rest.filter((i) => !i.serialOnly);
  const serial = rest.filter((i) => i.serialOnly);
  const out: CliPaletteGroup[] = [];
  if (recent.length) out.push({ name: 'Recent on this node', items: recent });
  const byGroup = new Map<string, CliSuggestion[]>();
  for (const i of avail) {
    const g = i.group ?? 'Info';
    const bucket = byGroup.get(g);
    if (bucket) bucket.push(i);
    else byGroup.set(g, [i]);
  }
  for (const [name, list] of byGroup) out.push({ name, items: list });
  if (serial.length) out.push({ name: 'Not available over radio', items: serial });
  return out;
}

/** The flattened display order — what the reducer navigates so ↑/↓ track the
 *  rendered rows exactly. A permutation of `items` (same members, regrouped). */
export function orderedSuggestions(parse: CliParse, items: CliSuggestion[]): CliSuggestion[] {
  return groupSuggestions(parse, items).flatMap((g) => g.items);
}

/** value.slice(0, replaceFrom) + insert + (replaceAll ? '' : value.slice(caret)),
 *  caret at replaceFrom + insert.length. Stated once in §2.3. */
export function applySuggestion(value: string, caret: number, s: CliSuggestion): { value: string; caret: number } {
  const head = value.slice(0, s.replaceFrom);
  const tail = s.replaceAll ? '' : value.slice(caret);
  return { value: head + s.insert + tail, caret: s.replaceFrom + s.insert.length };
}

/** Pull the bare value out of a get reply. replyValue if present, else accept
 *  the trimmed reply only when it is a single line with no ':' separator. If
 *  extraction fails, record nothing — a missing suggestion is recoverable, a
 *  wrong prefill is not. */
export function extractNodeValue(cmd: CliCommand, reply: string): string | null {
  if (!cmd.key) return null;
  if (cmd.replyValue) {
    const m = cmd.replyValue.exec(reply);
    return m ? (m[1] ?? m[0]).trim() || null : null;
  }
  const trimmed = reply.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes(':')) return null;
  return trimmed;
}

/** History stores raw lines. Map each ok line through the same longest-name
 *  resolution parse.ts uses, newest-first, collecting distinct names until max. */
export function deriveRecent(history: CliHistoryEntry[], max = 5): string[] {
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < max; i--) {
    if (history[i].status !== 'ok') continue;
    const cmd = resolveCommand(history[i].text);
    if (cmd && !out.includes(cmd.name)) out.push(cmd.name);
  }
  return out;
}
