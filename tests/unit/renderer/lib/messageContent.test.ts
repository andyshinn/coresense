import { describe, expect, it } from 'vitest';
import { parseMessageContent } from '../../../../src/renderer/lib/messageContent';

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
