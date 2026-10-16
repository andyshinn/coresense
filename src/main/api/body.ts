import type { Context } from 'hono';
import type { z } from 'zod';
import type { ApiErrorBody } from '../../shared/api/contract';

type Issue = NonNullable<ApiErrorBody['issues']>[number];

/** A request body that failed its schema. onApiError answers it with a 400
 *  `invalid_body`, so a route can let it propagate. */
export class InvalidBodyError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(`invalid body: ${issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')}`);
    this.name = 'InvalidBodyError';
    this.issues = issues;
  }
}

/** Parse the JSON body and validate it against `schema`, throwing
 *  InvalidBodyError on a missing, malformed or invalid body. The body is read
 *  whatever its Content-Type, as the routes always have.
 *
 *  `optional` is for endpoints whose every field is optional: a missing or
 *  unparsable body then validates as `{}`. */
export async function readJson<S extends z.ZodType>(
  c: Context,
  schema: S,
  opts: { optional?: boolean } = {},
): Promise<z.output<S>> {
  const raw: unknown = await c.req.json().catch(() => (opts.optional ? {} : undefined));
  if (raw === undefined) throw new InvalidBodyError([{ path: '', message: 'expected a JSON body' }]);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidBodyError(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return parsed.data;
}
