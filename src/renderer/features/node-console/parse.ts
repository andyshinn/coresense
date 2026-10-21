// Parse a console line against the command registry.

import { didYouMean } from './didYouMean';
import type { NodeCommand } from './types';

export type ParsedLine =
  | { kind: 'empty' }
  | { kind: 'command'; cmd: NodeCommand; args: string[] }
  | { kind: 'unknown'; message: string };

/** Split on whitespace, keeping "double quoted" runs together (quotes removed). */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null = re.exec(line);
  while (m) {
    out.push(m[1] ?? m[2]);
    m = re.exec(line);
  }
  return out;
}

/** The text after the first `words` words of `line`, trimmed; one pair of
 *  surrounding double quotes is removed. */
function restAfter(line: string, words: number): string {
  let rest = line.trim();
  for (let i = 0; i < words; i++) rest = rest.replace(/^\S+\s*/, '');
  rest = rest.trim();
  if (rest.length >= 2 && rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1);
  return rest;
}

function unknown(typed: string, suggestion: string | null): ParsedLine {
  return {
    kind: 'unknown',
    message: suggestion
      ? `Unknown command: ${typed} — did you mean ${suggestion}?`
      : `Unknown command: ${typed} — type help to list commands`,
  };
}

/** Resolve `line` to a command, longest name first ('set tx' over 'set'). */
export function parseConsoleLine(line: string, commands: readonly NodeCommand[]): ParsedLine {
  const tokens = tokenize(line);
  if (tokens.length === 0) return { kind: 'empty' };
  const lower = tokens.map((t) => t.toLowerCase());

  const byLength = [...commands].sort((a, b) => b.name.split(' ').length - a.name.split(' ').length);
  for (const cmd of byLength) {
    const words = cmd.name.split(' ');
    if (words.every((w, i) => lower[i] === w)) {
      const args = cmd.restArg ? [restAfter(line, words.length)].filter((a) => a.length > 0) : tokens.slice(words.length);
      return { kind: 'command', cmd, args };
    }
  }

  // Unknown. A known first word means the second is wrong ("get foo" → "get
  // radio"); otherwise the first word itself is ("stat" → "stats").
  const firstWords = commands.map((c) => c.name.split(' ')[0]);
  if (firstWords.includes(lower[0])) {
    const subcommands = commands.filter((c) => c.name.split(' ')[0] === lower[0] && c.name.includes(' '));
    const typed = tokens.slice(0, 2).join(' ');
    if (tokens.length < 2) {
      return {
        kind: 'unknown',
        message: `${tokens[0]} needs one of: ${subcommands.map((c) => c.name.split(' ')[1]).join(', ')}`,
      };
    }
    const sub = didYouMean(
      lower[1],
      subcommands.map((c) => c.name.split(' ')[1]),
    );
    return unknown(typed, sub ? `${lower[0]} ${sub}` : null);
  }
  return unknown(tokens[0], didYouMean(lower[0], firstWords));
}
