import { describe, expect, it } from 'vitest';
import { stateHolder } from '../../../src/main/state/holder';
import { messagesStore } from '../../../src/main/storage/messages';
import type {
  AddBlockRulesResponse,
  ApiErrorBody,
  BlockRuleResponse,
  NewBlockRule,
  OkResponse,
} from '../../../src/shared/api/contract';
import type { Message } from '../../../src/shared/types';
import { json, testRoutes } from '../../support/api';
import { captureBus } from '../../support/bus';

const RULE: NewBlockRule = { type: 'name', pattern: 'Spammer', tsFrom: 0, enabled: true, note: 'noisy' };

async function addRules(rules: NewBlockRule[]): Promise<AddBlockRulesResponse> {
  const res = await testRoutes().request('/api/blocks', json('POST', { rules }));
  expect(res.status).toBe(200);
  return (await res.json()) as AddBlockRulesResponse;
}

const ruleById = (id: string) =>
  stateHolder()
    .getBlockRules()
    .find((r) => r.id === id);

describe('POST /api/blocks', () => {
  it('adds one rule per entry, stamping id/createdAt/matchCount, and broadcasts the list', async () => {
    const broadcast = captureBus('blockRules');

    const { rules } = await addRules([RULE, { type: 'pubkeyPrefix', pattern: 'abcd', tsFrom: 0, enabled: false }]);

    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ ...RULE, matchCount: 0 });
    expect(rules[0].id).toEqual(expect.any(String));
    expect(rules[0].createdAt).toEqual(expect.any(Number));
    expect(rules[0].id).not.toBe(rules[1].id);
    for (const r of rules) expect(ruleById(r.id)).toEqual(r);
    expect(broadcast.last()?.map((r) => r.id)).toEqual(expect.arrayContaining(rules.map((r) => r.id)));
  });

  it('backfills match counts against stored messages from tsFrom on', async () => {
    messagesStore.insert({
      id: 'b1',
      key: 'ch:General',
      ts: 1_700_000_000_000,
      body: 'buy now',
      state: 'received',
      fromPublicKeyHex: 'name:Backfilled',
    } as Message);

    const { rules } = await addRules([{ type: 'name', pattern: 'Backfilled', tsFrom: 0, enabled: true }]);

    expect(ruleById(rules[0].id)?.matchCount).toBe(1);
  });
});

describe('PUT /api/blocks/:id', () => {
  it('applies the patch and broadcasts the list', async () => {
    const { rules } = await addRules([RULE]);
    const broadcast = captureBus('blockRules');

    const res = await testRoutes().request(
      `/api/blocks/${rules[0].id}`,
      json('PUT', { pattern: 'Spammer2', enabled: false, note: 'edited' }),
    );

    expect(res.status).toBe(200);
    const { rule } = (await res.json()) as BlockRuleResponse;
    expect(rule).toEqual({ ...rules[0], pattern: 'Spammer2', enabled: false, note: 'edited' });
    expect(ruleById(rules[0].id)).toEqual(rule);
    expect(broadcast.calls).toHaveLength(1);
  });

  it('answers 404 for an unknown id and broadcasts nothing', async () => {
    const broadcast = captureBus('blockRules');

    const res = await testRoutes().request('/api/blocks/no-such-rule', json('PUT', { enabled: false }));

    expect(res.status).toBe(404);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'not found' });
    expect(broadcast.calls).toHaveLength(0);
  });
});

describe('DELETE /api/blocks/:id', () => {
  it('removes the rule and broadcasts the list', async () => {
    const { rules } = await addRules([RULE]);
    const broadcast = captureBus('blockRules');

    const res = await testRoutes().request(`/api/blocks/${rules[0].id}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect((await res.json()) as OkResponse).toEqual({ ok: true });
    expect(ruleById(rules[0].id)).toBeUndefined();
    expect(broadcast.last()?.some((r) => r.id === rules[0].id)).toBe(false);
  });

  it('answers 404 for an unknown id and broadcasts nothing', async () => {
    const broadcast = captureBus('blockRules');

    const res = await testRoutes().request('/api/blocks/no-such-rule', { method: 'DELETE' });

    expect(res.status).toBe(404);
    expect((await res.json()) as ApiErrorBody).toEqual({ error: 'not found' });
    expect(broadcast.calls).toHaveLength(0);
  });
});
