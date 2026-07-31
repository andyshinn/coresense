// Which suggestion surface the caret is currently in. A discriminated union so
// the deferred variable/filter/macro modes (§2.1) stay additive.
import { CLI_COMMANDS, type CliCommand } from '../../../../../shared/repeater-cli/catalog';

export type CliParse =
  | { mode: 'command'; token: string; start: 0 }
  | { mode: 'arg'; cmd: CliCommand; argIndex: number; token: string; start: number };

/** Considers only text up to the caret. Exact equality with a command name
 *  stays in command mode; only `name + ' '` enters arg mode, and the LONGEST
 *  such match wins (`set radio` over `set`). */
export function parseCliLine(text: string, caret: number): CliParse {
  const head = text.slice(0, Math.max(0, Math.min(caret, text.length)));

  let best: { cmd: CliCommand; exact: boolean } | null = null;
  for (const c of CLI_COMMANDS) {
    if (head === c.name) {
      if (!best || c.name.length > best.cmd.name.length) best = { cmd: c, exact: true };
    } else if (head.startsWith(`${c.name} `)) {
      if (!best || c.name.length > best.cmd.name.length) best = { cmd: c, exact: false };
    }
  }

  if (best && !best.exact) {
    const rest = head.slice(best.cmd.name.length + 1);
    const parts = rest.split(/\s+/);
    const token = parts[parts.length - 1];
    return { mode: 'arg', cmd: best.cmd, argIndex: parts.length - 1, token, start: head.length - token.length };
  }

  return { mode: 'command', token: head, start: 0 };
}

/** Longest command name that equals the trimmed line or is a prefix of it
 *  followed by a space. Reused by suggest (recent derivation) and the reducer
 *  (danger confirmation). */
export function resolveCommand(text: string): CliCommand | null {
  const t = text.trim();
  let best: CliCommand | null = null;
  for (const c of CLI_COMMANDS) {
    if (t === c.name || t.startsWith(`${c.name} `)) {
      if (!best || c.name.length > best.name.length) best = c;
    }
  }
  return best;
}
