import { describe, expect, it } from 'vitest';
import { lintTemplate } from '../../../src/shared/macros/lint';
import { validateTemplate } from '../../../src/shared/macros/validate';

const names = (t: string) => lintTemplate(t).map((w) => w.name);

describe('lintTemplate — variable paths', () => {
  it('flags a property that does not exist, with the failing segment as the name', () => {
    const w = lintTemplate('{{ paths.first.hops.first.nope }}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('paths.first.hops.first.nope');
    expect(w[0].kind).toBe('unknown-property');
    expect(w[0].message).toContain('short_id');
  });

  it('accepts every path the sample really has', () => {
    for (const t of [
      '{{ paths.first.hops | map: "short_id" | join: "," }}',
      '{{ paths.first.all_hops | map: "kind" | join: "," }}',
      '{{ paths.first.length }}',
      '{{ paths.size }}',
      '{{ message_body.size }}',
      '{{ my_pos.lat }} {{ my_pos.lon }}',
      '{{ paths[0].hops[1].short_id }}',
    ]) {
      expect(names(t), t).toEqual([]);
    }
  });

  it('ignores template-local names from assign, for and capture', () => {
    expect(names('{% assign z = paths.first %}{{ z.hops }}')).toEqual([]);
    expect(names('{% for h in paths.first.hops %}{{ h.short_id }}{{ forloop.index }}{% endfor %}')).toEqual([]);
    expect(names('{% capture c %}x{% endcapture %}{{ c }}')).toEqual([]);
  });

  it('skips a dynamic subscript rather than guessing', () => {
    expect(names('{{ paths[my_name] }}')).toEqual([]);
  });
});

describe('lintTemplate — filter key arguments', () => {
  it('flags a bad map key and suggests the aliased field', () => {
    const w = lintTemplate('{{ paths.first.hops | map: "pubkey" | join: "," }}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('pubkey');
    expect(w[0].suggestion).toBe('pk');
    expect(w[0].line).toBe(1);
    expect(typeof w[0].col).toBe('number');
  });

  it('does not flag the original failing macro any more — pk is a real field now', () => {
    expect(names('{{ paths.first.hops | map: "pk" | join: "," }}')).toEqual([]);
  });

  it('accepts a key that exists', () => {
    expect(names('{{ paths.first.hops | where: "kind", "hop" | map: "short_id" }}')).toEqual([]);
  });

  it('does not require a key for sort, sort_natural or sum', () => {
    expect(names('{{ paths.first.hops | sort }}')).toEqual([]);
    expect(names('{{ paths.first.hops | sum }}')).toEqual([]);
  });

  it('follows map and first through the chain', () => {
    expect(names('{{ paths | map: "hops" | first | map: "short_id" | join: "," }}')).toEqual([]);
  });

  it('models group_by output so items is not a false positive', () => {
    expect(names('{{ paths.first.hops | group_by: "kind" | map: "items" | size }}')).toEqual([]);
  });

  it('abandons the chain after an unmodelled filter instead of guessing', () => {
    expect(names('{{ paths.first.hops | json | map: "anything" }}')).toEqual([]);
  });
});

describe('lintTemplate — totality and independence', () => {
  it('returns [] for a template that does not parse', () => {
    expect(lintTemplate('{{ paths.')).toEqual([]);
    expect(lintTemplate('{{ paths | nope }}')).toEqual([]);
    expect(lintTemplate('{% for x in %}')).toEqual([]);
  });

  it('never changes what validateTemplate reports', () => {
    for (const t of ['{{ paths.first.hops | map: "pubkey" }}', '{{ my_name }}', '{{ paths.']) {
      const before = JSON.stringify(validateTemplate(t));
      lintTemplate(t);
      expect(JSON.stringify(validateTemplate(t))).toBe(before);
    }
  });

  it('accepts deep indexing that the sample can actually resolve', () => {
    expect(names('{{ paths.first.hops.first.short_id }}')).toEqual([]);
    expect(names('{{ paths.first.all_hops.last.kind }}')).toEqual([]);
  });
});
