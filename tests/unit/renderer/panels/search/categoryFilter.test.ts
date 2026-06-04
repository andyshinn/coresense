import { describe, expect, it } from 'vitest';
import { applyCategorySelection } from '@/panels/search/categoryFilter';
import type { SearchCategory } from '../../../../../src/shared/types';

describe('applyCategorySelection', () => {
  it('returns the next selection when it is non-empty', () => {
    const current: SearchCategory[] = ['channel', 'dm', 'contact'];
    expect(applyCategorySelection(['channel', 'contact'], current)).toEqual(['channel', 'contact']);
  });

  it('keeps the current selection when next is empty (at least one stays on)', () => {
    const current: SearchCategory[] = ['dm'];
    expect(applyCategorySelection([], current)).toEqual(['dm']);
  });

  it('preserves the order and values of next', () => {
    const current: SearchCategory[] = ['channel'];
    expect(applyCategorySelection(['contact', 'dm', 'channel'], current)).toEqual([
      'contact',
      'dm',
      'channel',
    ]);
  });
});
