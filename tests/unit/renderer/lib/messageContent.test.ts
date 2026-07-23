import { describe, expect, it } from 'vitest';
import { mentionedNames, parseMessageContent } from '../../../../src/renderer/lib/messageContent';

describe('parseMessageContent', () => {
  it('returns a single text token for plain text', () => {
    expect(parseMessageContent('hello world')).toEqual([{ type: 'text', value: 'hello world' }]);
  });

  it('extracts @[mentions]', () => {
    const tokens = parseMessageContent('hi @[Alice]!');
    expect(tokens).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', name: 'Alice' },
      { type: 'text', value: '!' },
    ]);
  });

  it('extracts web links and trims trailing sentence punctuation', () => {
    const tokens = parseMessageContent('see https://x.com.');
    expect(tokens).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', href: 'https://x.com' },
      { type: 'text', value: '.' },
    ]);
  });

  it('extracts a known custom URI scheme', () => {
    const tokens = parseMessageContent('add meshcore://abcd here');
    expect(tokens[1]).toEqual({ type: 'uri', scheme: 'meshcore', raw: 'meshcore://abcd' });
  });
});

describe('mentionedNames', () => {
  it('returns [] for plain text with no mentions', () => {
    expect(mentionedNames('hello world')).toEqual([]);
  });

  it('returns the single mentioned name', () => {
    expect(mentionedNames('hi @[Alice]!')).toEqual(['Alice']);
  });

  it('returns every mention in first-appearance order', () => {
    expect(mentionedNames('@[Alice] and @[Bob]')).toEqual(['Alice', 'Bob']);
  });

  it('de-duplicates repeated mentions, keeping first-appearance order', () => {
    expect(mentionedNames('@[Bob] hi @[Alice] @[Bob]')).toEqual(['Bob', 'Alice']);
  });

  it('ignores a partially-typed / broken token', () => {
    expect(mentionedNames('@[TLF hello')).toEqual([]);
  });

  it('extracts the name from a reaction insertion, ignoring the emoji', () => {
    expect(mentionedNames('@[K5TH] 👍 ')).toEqual(['K5TH']);
  });

  it('keeps names with spaces intact', () => {
    expect(mentionedNames('thanks @[Air Force 1 Pocket]')).toEqual(['Air Force 1 Pocket']);
  });
});
