import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { userDataDir } from '../../runtime/userData';

let cachedKey: string | null = null;

/** Absolute path of the JSON file that stores the shared API key. */
export function getConfigPath(): string {
  return join(userDataDir(), 'config.json');
}

export function getApiKey(): string {
  if (cachedKey) return cachedKey;
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as { apiKey?: string };
      if (parsed.apiKey && parsed.apiKey.length >= 32) {
        cachedKey = parsed.apiKey;
        return cachedKey;
      }
    } catch {
      // fall through to regenerate
    }
  }
  const apiKey = randomBytes(32).toString('hex');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ apiKey }, null, 2), 'utf8');
  try {
    chmodSync(configPath, 0o600);
  } catch {
    // ignore on platforms that don't support chmod
  }
  cachedKey = apiKey;
  // A direct write, deliberately not the tslog logger: its file sink would
  // persist the secret (docs/SECURITY_HARDENING_PLAN.md §5).
  console.log(
    [
      '',
      '════════════════════════════════════════════════════════════════',
      ' CoreSense API key (first run — saved to userData/config.json):',
      ` ${apiKey}`,
      '════════════════════════════════════════════════════════════════',
      '',
    ].join('\n'),
  );
  return apiKey;
}

// Only consulted under '/api/*', where this middleware is mounted.
const PUBLIC_PATHS = new Set(['/api/capabilities']);

/** Constant-time comparison of a presented key against the stored one. */
function keyMatches(providedKey: string): boolean {
  const provided = Buffer.from(providedKey);
  const expected = Buffer.from(getApiKey());
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return c.json({ error: 'Missing Authorization' }, 401);

  if (!keyMatches(match[1].trim())) return c.json({ error: 'Invalid API key' }, 401);
  return next();
};

export function checkWsKey(providedKey: string | undefined | null): boolean {
  if (!providedKey) return false;
  return keyMatches(providedKey);
}
