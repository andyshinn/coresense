import { describe, expect, it } from 'vitest';
import { spliceAtCaret } from '@/panels/macros/lib/insertAtCaret';

describe('spliceAtCaret', () => {
  it('inserts at a collapsed caret and advances the caret past the insert', () => {
    const res = spliceAtCaret('ab', 1, 1, 'X');
    expect(res.value).toBe('aXb');
    expect(res.caret).toBe(2);
  });

  it('replaces a selection with the inserted text', () => {
    const res = spliceAtCaret('hello world', 6, 11, 'there');
    expect(res.value).toBe('hello there');
    expect(res.caret).toBe(11);
  });

  it('appends at the end when the caret is at the end', () => {
    const res = spliceAtCaret('hi ', 3, 3, '{{ snr }}');
    expect(res.value).toBe('hi {{ snr }}');
    expect(res.caret).toBe(12);
  });
});
