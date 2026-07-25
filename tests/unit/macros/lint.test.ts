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

  it('accepts a dotted key that resolves through the element shape (map/sort/where/sum/group_by)', () => {
    for (const t of [
      '{{ paths | map: "hops.first.short_id" | join: "," }}',
      '{{ paths | sort: "hops.first.short_id" | map: "id" | join: "," }}',
      '{{ paths | where: "hops.first.short_id", "a1" | map: "id" | join: "," }}',
      '{{ paths | sum: "hops.first.short_id" }}',
      '{{ paths | group_by: "hops.first.short_id" | map: "name" | join: "," }}',
    ]) {
      expect(names(t), t).toEqual([]);
    }
  });

  it('flags a dotted key that fails deep in the path, naming the full key the user typed', () => {
    const w = lintTemplate('{{ paths | map: "hops.first.nope" | join: "," }}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('hops.first.nope');
  });

  it('suggests from the level the walk actually failed at, not the top level', () => {
    // 'nope' is levenshtein-2 from both top-level "hops" and nested "name" — this
    // only passes if the candidate list comes from the hops.first object
    // (kind/short_id/name/pk), not from paths' own top-level fields.
    const w = lintTemplate('{{ paths | map: "hops.first.nope" | join: "," }}');
    expect(w[0].suggestion).toBe('name');
  });

  it('resolves a dotted map key so the chain keeps advancing (not abandoned as null)', () => {
    expect(names('{{ paths | map: "hops.first" | map: "short_id" | join: "," }}')).toEqual([]);
    const w = lintTemplate('{{ paths | map: "hops.first" | map: "nope" | join: "," }}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('nope');
  });
});

describe('lintTemplate — filter keys nested inside block tags', () => {
  it('warns on a property filter inside {% if %}', () => {
    const w = lintTemplate('{% if paths.first %}{{ paths.first.hops | map: "pubkey" }}{% endif %}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('pubkey');
    expect(w[0].suggestion).toBe('pk');
  });

  it('warns on a property filter inside {% unless %}', () => {
    const w = lintTemplate('{% unless paths.size == 0 %}{{ paths.first.hops | map: "pubkey" }}{% endunless %}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('pubkey');
  });

  it('warns on a property filter inside {% case %}', () => {
    const w = lintTemplate('{% case peer_name %}{% when "Alice" %}{{ paths.first.hops | map: "pubkey" }}{% endcase %}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('pubkey');
  });

  it('does not spuriously warn about the {% for %} loop-local head, even though it stays silent on the real key', () => {
    // `p` is a loop-local, not a context path — the sample can't resolve `p.hops`,
    // so this case is allowed to stay silent rather than guess. It must NOT
    // produce a bogus warning naming `p`.
    const w = lintTemplate('{% for p in paths %}{{ p.hops | map: "pubkey" }}{% endfor %}');
    expect(w).toEqual([]);
  });

  it('also walks into {% capture %} bodies', () => {
    const w = lintTemplate('{% capture c %}{{ paths.first.hops | map: "pubkey" }}{% endcapture %}{{ c }}');
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('pubkey');
  });

  it('stays total for a tag type with no children() method (comment)', () => {
    // CommentTag has no children() at all — the traversal guard must not throw
    // when it encounters one, and comment bodies aren't parsed anyway so there
    // is nothing to flag inside it.
    expect(() => lintTemplate('{% comment %}{{ paths.first.hops | map: "pubkey" }}{% endcomment %}')).not.toThrow();
    expect(names('{% comment %}{{ paths.first.hops | map: "pubkey" }}{% endcomment %}')).toEqual([]);
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
