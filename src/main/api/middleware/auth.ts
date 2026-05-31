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
  // eslint-disable-next-line no-console
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

const PUBLIC_PATHS = new Set(['/', '/api/capabilities']);

export const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();

  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return c.json({ error: 'Missing Authorization' }, 401);

  const provided = Buffer.from(match[1].trim());
  const expected = Buffer.from(getApiKey());
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return c.json({ error: 'Invalid API key' }, 401);
  }
  return next();
};

export function checkWsKey(providedKey: string | undefined | null): boolean {
  if (!providedKey) return false;
  const provided = Buffer.from(providedKey);
  const expected = Buffer.from(getApiKey());
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
