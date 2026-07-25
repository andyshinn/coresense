import { describe, expect, it } from 'vitest';
import { detectOpenVarTag } from '@/panels/macros/lib/autocomplete';

describe('detectOpenVarTag', () => {
  it('matches an open tag with a partial name and reports where it starts', () => {
    expect(detectOpenVarTag('hello {{ sen')).toEqual({ partial: 'sen', start: 6 });
  });

  it('matches an open tag with no partial yet', () => {
    expect(detectOpenVarTag('hello {{ ')).toEqual({ partial: '', start: 6 });
    expect(detectOpenVarTag('hello {{')).toEqual({ partial: '', start: 6 });
  });

  it('returns null once the tag is closed', () => {
    expect(detectOpenVarTag('hello {{ snr }}')).toBeNull();
  });

  it('returns null when there is no open tag', () => {
    expect(detectOpenVarTag('hello world')).toBeNull();
    expect(detectOpenVarTag('')).toBeNull();
  });

  it('locks onto the most recent open tag', () => {
    expect(detectOpenVarTag('{{ a }}{{ b')).toEqual({ partial: 'b', start: 7 });
  });
});
