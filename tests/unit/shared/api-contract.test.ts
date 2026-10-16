import { Models } from '@andyshinn/meshcore-ts';
import { describe, expect, it } from 'vitest';
import { CLI_REPLY_TIMEOUT_MS } from '../../../src/shared/api/contract';

describe('shared API contract', () => {
  // The renderer cannot import meshcore-ts, so the contract restates the
  // library's CLI reply timeout. Pin the copy to the source.
  it('mirrors the library CLI reply timeout', () => {
    expect(CLI_REPLY_TIMEOUT_MS).toBe(Models.CLI_REPLY_TIMEOUT_MS);
  });
});
