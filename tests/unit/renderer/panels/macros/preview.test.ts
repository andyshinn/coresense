import { describe, expect, it } from 'vitest';
import { budgetStatus, MSG_LIMIT } from '@/panels/macros/lib/preview';

describe('MSG_LIMIT', () => {
  it('is the MeshCore 132-char text frame budget', () => {
    expect(MSG_LIMIT).toBe(132);
  });
});

describe('budgetStatus', () => {
  it("is 'ok' well under the limit", () => {
    expect(budgetStatus(0)).toBe('ok');
    expect(budgetStatus(112)).toBe('ok');
  });

  it("is 'warn' from 85% up to the limit inclusive", () => {
    expect(budgetStatus(113)).toBe('warn');
    expect(budgetStatus(132)).toBe('warn');
  });

  it("is 'over' past the limit", () => {
    expect(budgetStatus(133)).toBe('over');
  });
});
