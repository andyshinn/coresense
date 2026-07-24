# Macro Structure Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make macro context structure discoverable — fix the relay path shape, then surface structure through hover cards, a Context tab, and an unknown-property lint.

**Architecture:** One runtime derivation (`structureOf`) over `buildSampleContext()` feeds three consumers: hover cards, a Context tree, and a static lint. The path shape changes first because everything downstream describes it. The lint is a separate module from `validateTemplate` so warnings never block saving.

**Tech Stack:** TypeScript, React 19, liquidjs 10.27, Zustand, Radix (`radix-ui` unified package), Tailwind v4, Vitest (3 projects), Biome 2.5.

**Spec:** [`docs/superpowers/specs/2026-07-23-macro-structure-inspection-design.md`](../specs/2026-07-23-macro-structure-inspection-design.md)

## Global Constraints

- **Worktree:** work in `.claude/worktrees/feat+custom-macros` on branch `feat/custom-macros`. `git add`/`commit` need the sandbox disabled.
- **Tooling:** run `npx <tool>`, never `pnpm run <script>` (pnpm deps-check reflink-fails in worktrees).
- **Verify with:** `npx vitest run`, `npx tsc --noEmit`, `npx biome check src tests`. All three pass on the current tree — keep them passing.
- **No `globals: true`** — every test file imports `describe/it/expect` from `vitest` explicitly.
- **`jest-dom` is NOT installed** — assert with `toBeTruthy()`, never `toBeInTheDocument()`.
- **`@testing-library/user-event` is NOT a dependency** — use `fireEvent` only.
- **Vitest projects:** `unit` (node, `tests/unit/**/*.test.ts`), `integration` (node), `dom` (jsdom, `tests/component/**/*.test.tsx` — **`.tsx` only**, a `.ts` file there never runs).
- **Zero snapshots** exist in the repo — assert explicit values.
- **Biome:** lineWidth 125, 2-space indent, single quotes in JS, double quotes in JSX, semicolons, trailing commas.
- **Design tokens:** `cs-bg`, `cs-bg-2`, `cs-bg-3`, `cs-text`, `cs-text-muted`, `cs-text-dim`, `cs-border`, `cs-border-strong`, `cs-accent`, `cs-warn`, `cs-danger`. **`cs-error` does not exist** — use `cs-danger`.
- **Contrast:** `text-cs-text-dim` on `bg-cs-bg-3` is sub-AA (3.76:1 dark / 3.03:1 light). Use `text-cs-text-muted` (8.15 / 6.01) for new badges on `bg-cs-bg-3`.
- **Commit style:** conventional commits, scope `macros`. End every commit message with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

**Created**
| File | Responsibility |
| --- | --- |
| `src/shared/macros/structure.ts` | Derive a shape tree from a runtime value; resolve dotted paths against it. Pure. |
| `src/shared/macros/lint.ts` | Walk a template for property names that don't exist in the sample shape. Pure + liquidjs. |
| `src/renderer/panels/macros/studio/VariableHoverCard.tsx` | Prop-driven hover body for a variable row. |
| `src/renderer/panels/macros/studio/FilterHoverCard.tsx` | Prop-driven hover body for a filter row. |
| `src/renderer/panels/macros/studio/ContextTree.tsx` | Prop-driven expandable tree of a sample context. |

**Modified**
| File | Change |
| --- | --- |
| `src/shared/macros/types.ts` | `MacroPathHop` gains `pk`; `MacroPath` gains `all_hops`, `length` redefined. |
| `src/main/macros/contextBuilder.ts` | `resolveHop`, relay-only `mapPaths`, `buildReplyContext` takes `repeaters`. |
| `src/main/api/routes.ts` | Pass repeaters to `buildReplyContext`. |
| `src/shared/macros/manifest.ts` | Sample path gains relays + `all_hops` + `pk`; `paths` docs/example updated. |
| `src/renderer/panels/macros/lib/sampleContext.ts` | `WORST_CASE_PATH` gains `all_hops` + `pk`. |
| `src/shared/macros/placeholder.ts` | Add `toJSON()`. |
| `src/shared/macros/index.ts` | Export `structureOf`/`resolvePath`/`fieldsAt`/`lintTemplate` + types. |
| `src/renderer/panels/macros/MacroStudio.tsx` | Single column; compute + pass `warnings`; hover cards on quick-var chips. |
| `src/renderer/panels/macros/studio/PreviewPane.tsx` | Drop `h-full`; render warnings; derive caption; memoise `ctx`. |
| `src/renderer/panels/macros/studio/ReferencePanel.tsx` | `json`/`inspect` docs; `map` stub fix; `hoverCard` prop; Context tab. |

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Tasks 3–5 are independent of 1–2 but are sequenced after so the sample context is final before `structureOf` is tested against it.

---

### Task 1: Relay-only path shape + hop resolution

**Files:**
- Modify: `src/shared/macros/types.ts:8-24`
- Modify: `src/main/macros/contextBuilder.ts:1-32`, `:89-114`
- Modify: `src/main/api/routes.ts:986`
- Test: `tests/unit/macros/contextBuilder.test.ts`

**Interfaces:**
- Produces: `MacroPathHop { kind, short_id, name: string|null, pk: string|null }`; `MacroPath { id, length, hash_mode, final_snr, hops, all_hops }`; `buildReplyContext({ self, message, senderContact, channelName, repeaters, now? })`.

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe('buildReplyContext', …)` block in `tests/unit/macros/contextBuilder.test.ts` (from line 55 to the end of file) with:

```ts
describe('buildReplyContext', () => {
  const pathHops = [
    { kind: 'origin' as const, shortId: 'aa', name: 'Alice', pk: 'alicepk' },
    { kind: 'hop' as const, shortId: 'a1', name: null, pk: null },
    { kind: 'hop' as const, shortId: '37', name: null, pk: null },
    { kind: 'sink' as const, shortId: 'bb', name: 'Me', pk: 'aabbccdd' },
  ];

  const message: Message = {
    id: 'm1',
    key: 'ch:General',
    fromPublicKeyHex: 'alicepk',
    body: 'hi',
    ts: 1700000000000,
    state: 'received',
    meta: {
      rssi: -95,
      snr: 5.5,
      hops: 2,
      timesHeard: 3,
      paths: [{ id: 'p1', hashMode: 1, finalSnr: 6, hops: pathHops }],
    },
  };

  const directMessage: Message = {
    ...message,
    meta: {
      ...message.meta,
      paths: [{ id: 'p2', hashMode: 1, finalSnr: 6, hops: [pathHops[0], pathHops[3]] }],
    },
  };

  const repeater = (name: string, publicKeyHex: string): Contact => ({
    key: `c:${publicKeyHex}`,
    publicKeyHex,
    name,
    kind: 'repeater',
  });

  const reply = (over: { message?: Message; repeaters?: Contact[] } = {}) =>
    buildReplyContext({
      self,
      message: over.message ?? message,
      senderContact: alice,
      channelName: 'General',
      repeaters: over.repeaters ?? [],
      now: 1700000300000,
    });

  it('maps message signal, sender, and peer-from-sender on a channel', () => {
    const ctx = reply();
    expect(ctx.message_body).toBe('hi');
    expect(ctx.rssi).toBe(-95);
    expect(ctx.times_heard).toBe(3);
    expect(ctx.sender_name).toBe('Alice');
    expect(ctx.sender_id).toBe('alicepk');
    expect(ctx.peer_name).toBe('Alice'); // peer resolved from the sender, even on a channel
    expect(ctx.received_ago).toBe('5m');
    expect(ctx.paths).toHaveLength(1);
    expect(ctx.paths[0].final_snr).toBe(6);
  });

  it('exposes only relay hops in hops, and the full timeline in all_hops', () => {
    const ctx = reply();
    expect(ctx.paths[0].hops.map((h) => h.short_id)).toEqual(['a1', '37']);
    expect(ctx.paths[0].hops.every((h) => h.kind === 'hop')).toBe(true);
    expect(ctx.paths[0].all_hops.map((h) => h.short_id)).toEqual(['aa', 'a1', '37', 'bb']);
    expect(ctx.paths[0].all_hops.map((h) => h.name)).toEqual(['Alice', null, null, 'Me']);
  });

  it('reports length as the relay count, not the timeline length', () => {
    expect(reply().paths[0].length).toBe(2);
  });

  it('reports length 0 and empty hops for a direct path', () => {
    const ctx = reply({ message: directMessage });
    expect(ctx.paths[0].length).toBe(0);
    expect(ctx.paths[0].hops).toEqual([]);
    expect(ctx.paths[0].all_hops).toHaveLength(2);
  });

  it('resolves a relay hop name and pk from an unambiguous repeater match', () => {
    const ctx = reply({ repeaters: [repeater('Tarrytown East Solar', 'a137f2aa')] });
    expect(ctx.paths[0].hops[0]).toMatchObject({
      short_id: 'a1',
      name: 'Tarrytown East Solar',
      pk: 'a137f2aa',
    });
    expect(ctx.paths[0].hops[1]).toMatchObject({ short_id: '37', name: null, pk: null });
  });

  it('leaves name and pk null when two repeaters share the prefix', () => {
    const ctx = reply({ repeaters: [repeater('One', 'a137f2aa'), repeater('Two', 'a1ff0000')] });
    expect(ctx.paths[0].hops[0]).toMatchObject({ name: null, pk: null });
  });

  it('ignores a non-repeater contact whose pubkey matches the prefix', () => {
    // A phone must never be named as a mesh relay. resolveHop guards on kind
    // itself, so this holds even if a caller forgets to pre-filter.
    const phone: Contact = { key: 'c:a1cafe', publicKeyHex: 'a1cafe22', name: 'Bob (phone)', kind: 'chat' };
    expect(reply({ repeaters: [phone] }).paths[0].hops[0]).toMatchObject({ name: null, pk: null });
  });

  it('does not let a non-repeater manufacture ambiguity', () => {
    // The Path viewer resolves against repeaters only; a chat contact sharing
    // the prefix must not blank out a name the viewer shows confidently.
    const phone: Contact = { key: 'c:a1cafe', publicKeyHex: 'a1cafe22', name: 'Bob (phone)', kind: 'chat' };
    const ctx = reply({ repeaters: [repeater('Tarrytown East Solar', 'a137f2aa'), phone] });
    expect(ctx.paths[0].hops[0].name).toBe('Tarrytown East Solar');
  });

  it('leaves name and pk null for an empty short_id', () => {
    const blank: Message = {
      ...message,
      meta: {
        ...message.meta,
        paths: [{ id: 'p3', hashMode: 1, finalSnr: 6, hops: [{ kind: 'hop', shortId: '', name: null, pk: null }] }],
      },
    };
    const ctx = reply({ message: blank, repeaters: [repeater('Only', 'deadbeef')] });
    expect(ctx.paths[0].hops[0]).toMatchObject({ name: null, pk: null });
  });

  it('origin and sink never carry a resolved pk', () => {
    const ctx = reply({ repeaters: [repeater('Tarrytown', 'a137f2aa')] });
    const ends = ctx.paths[0].all_hops.filter((h) => h.kind !== 'hop');
    expect(ends.map((h) => h.pk)).toEqual([null, null]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/macros/contextBuilder.test.ts`
Expected: FAIL — TypeScript/runtime errors on `all_hops` being undefined and `repeaters` not accepted.

- [ ] **Step 3: Update the types**

In `src/shared/macros/types.ts`, replace lines 8-24 (the `MacroPathHop` and `MacroPath` interfaces, including the existing four-line comment about `pk`) with:

```ts
export interface MacroPathHop {
  /** In `hops` this is always 'hop'. `all_hops` also carries 'origin' and 'sink'. */
  kind: 'origin' | 'hop' | 'sink';
  /** Relay hops: the per-hop key prefix as encoded on the wire (1-3 bytes hex,
   *  per the path's hash_mode). Origin/sink in `all_hops`: a lowercased 2-char
   *  slice of the node name — a display label, NOT wire data. */
  short_id: string;
  /** The matching repeater's name, resolved locally from short_id. Null when no
   *  repeater matches or when more than one does. Origin/sink carry the sender /
   *  owner name as supplied by the library. */
  name: string | null;
  /** The matching repeater's full pubkey, same resolution rules as `name`. Never
   *  on the wire — only the prefix is — so this is a local resolution, and null
   *  whenever ambiguous, unknown, or for origin/sink. */
  pk: string | null;
}

export interface MacroPath {
  id: string;
  /** Number of RELAY hops between the sender and us. 0 on a direct path. */
  length: number;
  hash_mode: number;
  final_snr: number;
  /** Relay hops only — the repeaters between the sender and us. Empty on a
   *  direct path. */
  hops: MacroPathHop[];
  /** The full timeline: origin (sender), every relay, then sink (us). */
  all_hops: MacroPathHop[];
}
```

- [ ] **Step 4: Implement `resolveHop` and the new `mapPaths`**

In `src/main/macros/contextBuilder.ts`, change the type import on line 2 to include `MacroPathHop`:

```ts
import type { MacroContext, MacroPath, MacroPathHop, MacroPosition } from '../../shared/macros/types';
```

Replace `mapPaths` (lines 23-32) with:

```ts
/** Resolve a relay hop's wire prefix against known repeaters. Demands exactly
 *  one match: at hash_mode 1 a prefix is two hex chars, so collisions are
 *  ordinary, and macro output is transmitted — a wrong operator name is worse
 *  than a blank. Mirrors candidatesFor() in the renderer's path viewer, which is
 *  likewise only ever fed contacts of kind 'repeater'. */
function resolveHop(shortId: string, repeaters: Contact[]): { name: string | null; pk: string | null } {
  if (shortId.length === 0) return { name: null, pk: null }; // startsWith('') matches everything
  const prefix = shortId.toLowerCase();
  // The kind guard is defence in depth — callers pass a pre-filtered list, but a
  // chat contact leaking in here would name someone's phone as a mesh relay.
  const matches = repeaters.filter((c) => c.kind === 'repeater' && c.publicKeyHex.toLowerCase().startsWith(prefix));
  if (matches.length !== 1) return { name: null, pk: null }; // unknown OR ambiguous
  return { name: matches[0].name, pk: matches[0].publicKeyHex };
}

function mapPaths(paths: MessagePath[] | undefined, repeaters: Contact[]): MacroPath[] {
  if (!paths) return [];
  return paths.map((p) => {
    const all: MacroPathHop[] = p.hops.map((h) =>
      h.kind === 'hop'
        ? { kind: h.kind, short_id: h.shortId, ...resolveHop(h.shortId, repeaters) }
        : { kind: h.kind, short_id: h.shortId, name: h.name ?? null, pk: null },
    );
    const relays = all.filter((h) => h.kind === 'hop');
    return {
      id: p.id,
      length: relays.length,
      hash_mode: p.hashMode,
      final_snr: p.finalSnr,
      hops: relays,
      all_hops: all,
    };
  });
}
```

In `emptyReplyFields` (lines 60-74) the `paths: [] as MacroPath[]` line is unchanged.

Change `buildReplyContext`'s signature and its `paths` line (lines 89-113):

```ts
export function buildReplyContext(args: {
  self: SelfState;
  message: Message;
  senderContact: Contact | null;
  channelName: string | null;
  /** Contacts of kind 'repeater' only — see resolveHop. */
  repeaters: Contact[];
  now?: number;
}): MacroContext {
```

and, inside the returned object, replace `paths: mapPaths(m.meta?.paths),` with:

```ts
    paths: mapPaths(m.meta?.paths, args.repeaters),
```

- [ ] **Step 5: Pass repeaters from the API route**

In `src/main/api/routes.ts`, replace line 986 with:

```ts
      const repeaters = holder.getContacts().filter((ct) => ct.kind === 'repeater');
      context = buildReplyContext({ self, message, senderContact, channelName, repeaters });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run --project unit tests/unit/macros/contextBuilder.test.ts`
Expected: PASS (11 tests).

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/shared/macros/manifest.ts` and `src/renderer/panels/macros/lib/sampleContext.ts` (`Property 'all_hops' is missing`, `Property 'pk' is missing`) — those are fixed in Task 2.

- [ ] **Step 7: Commit**

```bash
git add src/shared/macros/types.ts src/main/macros/contextBuilder.ts src/main/api/routes.ts tests/unit/macros/contextBuilder.test.ts
git commit -m "$(cat <<'EOF'
feat(macros): relay-only path hops with resolved names and pk

hops now holds only the repeaters between sender and us; all_hops keeps the
full origin->sink timeline; length is the relay count (0 = direct), fixing a
bug where it counted the endpoints. Relay names and pubkeys resolve against
known repeaters on an unambiguous prefix match only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Sample context and manifest docs

**Files:**
- Modify: `src/shared/macros/manifest.ts:78-84`, `:139-150`
- Modify: `src/renderer/panels/macros/lib/sampleContext.ts:20-32`
- Test: `tests/unit/macros/manifest.test.ts`, `tests/unit/renderer/panels/macros/sampleContext.test.ts`

**Interfaces:**
- Consumes: `MacroPath`/`MacroPathHop` from Task 1.
- Produces: `buildSampleContext().paths[0]` with two relay hops — one resolved (`name`+`pk` set), one not (both `null`) — which Task 4 relies on to derive nullability.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/macros/manifest.test.ts`, replace the `it('documents short_id (not pk) …')` test with:

```ts
  it('documents the relay-only hops example with a direct fallback', () => {
    const paths = MACRO_VARIABLES.find((v) => v.name === 'paths');
    expect(paths?.example).toContain('short_id');
    expect(paths?.example).toContain('default: "direct"');
    expect(paths?.description).toContain('all_hops');
  });

  it('sample path carries relay hops, one resolved and one not', () => {
    const path = buildSampleContext().paths[0];
    expect(path.hops.length).toBe(2);
    expect(path.length).toBe(2);
    expect(path.hops.every((h) => h.kind === 'hop')).toBe(true);
    expect(path.hops.map((h) => h.name)).toEqual(['Tarrytown East Solar', null]);
    expect(path.hops.map((h) => h.pk)).toEqual(['a137f2aa', null]);
    expect(path.all_hops.map((h) => h.kind)).toEqual(['origin', 'hop', 'hop', 'sink']);
  });
```

In `tests/unit/renderer/panels/macros/sampleContext.test.ts`, replace the final `it('path hops never carry pk …')` test with:

```ts
  it('sample paths expose relay hops with pk, and a full all_hops timeline', () => {
    for (const ctx of [replyContext(), worstCaseContext()]) {
      const path = ctx.paths[0];
      expect(path.hops.length).toBeGreaterThan(0);
      expect(path.length).toBe(path.hops.length);
      for (const hop of path.hops) {
        expect(hop.kind).toBe('hop');
        expect(hop.short_id).toBeTruthy();
      }
      expect(path.all_hops[0].kind).toBe('origin');
      expect(path.all_hops[path.all_hops.length - 1].kind).toBe('sink');
      expect(path.all_hops.length).toBe(path.hops.length + 2);
    }
  });

  it('reply sample has one resolved and one unresolved relay hop', () => {
    const hops = replyContext().paths[0].hops;
    expect(hops.some((h) => h.pk !== null)).toBe(true);
    expect(hops.some((h) => h.pk === null)).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit tests/unit/macros/manifest.test.ts tests/unit/renderer/panels/macros/sampleContext.test.ts`
Expected: FAIL — `path.hops.length` is 2 but both are origin/sink, `all_hops` undefined.

- [ ] **Step 3: Update the manifest `paths` entry**

In `src/shared/macros/manifest.ts`, replace lines 77-84 (the `paths` object) with:

```ts
  {
    name: 'paths',
    description:
      'Relay paths this message took. `hops` is the repeaters between the sender and you (empty when direct); `all_hops` adds the sender and your radio at the ends. `length` is the relay count. Each hop has kind/short_id/name/pk — name and pk resolve only when exactly one known repeater matches the prefix.',
    type: 'array',
    example: '{{ paths.first.hops | map: "short_id" | join: " → " | default: "direct" }}',
    available: 'reply',
  },
```

- [ ] **Step 4: Update the sample path**

In `src/shared/macros/manifest.ts`, replace lines 139-150 (the `paths: [...]` entry of `buildSampleContext`) with:

```ts
    paths: [
      {
        id: 'p1',
        length: 2,
        hash_mode: 1,
        final_snr: 6.5,
        hops: [
          { kind: 'hop', short_id: 'a1', name: 'Tarrytown East Solar', pk: 'a137f2aa' },
          { kind: 'hop', short_id: '37', name: null, pk: null },
        ],
        all_hops: [
          { kind: 'origin', short_id: 'al', name: 'Alice', pk: null },
          { kind: 'hop', short_id: 'a1', name: 'Tarrytown East Solar', pk: 'a137f2aa' },
          { kind: 'hop', short_id: '37', name: null, pk: null },
          { kind: 'sink', short_id: 'me', name: 'Me', pk: null },
        ],
      },
    ],
```

- [ ] **Step 5: Update `WORST_CASE_PATH`**

In `src/renderer/panels/macros/lib/sampleContext.ts`, replace lines 20-32 with:

```ts
const WORST_CASE_HOPS = [
  { kind: 'hop' as const, short_id: 'a1', name: 'Tarrytown East Solar', pk: 'a137f2aa' },
  { kind: 'hop' as const, short_id: '37', name: 'SOCO RAK Repeater 🛒', pk: '37c0dd01' },
  { kind: 'hop' as const, short_id: 'a8', name: 'Mt. Bonnell 🗻', pk: 'a8be1100' },
];

const WORST_CASE_PATH: MacroPath = {
  id: 'x',
  length: WORST_CASE_HOPS.length,
  hash_mode: 1,
  final_snr: 11,
  hops: WORST_CASE_HOPS,
  all_hops: [
    { kind: 'origin', short_id: 'c5', name: 'EDM9/R Edwards Mtn', pk: null },
    ...WORST_CASE_HOPS,
    { kind: 'sink', short_id: 'eH', name: 'egrme.sh Hand', pk: null },
  ],
};
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run --project unit tests/unit/macros tests/unit/renderer/panels/macros`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: PASS — full suite green.

- [ ] **Step 7: Commit**

```bash
git add src/shared/macros/manifest.ts src/renderer/panels/macros/lib/sampleContext.ts tests/unit/macros/manifest.test.ts tests/unit/renderer/panels/macros/sampleContext.test.ts
git commit -m "$(cat <<'EOF'
feat(macros): sample paths carry relay hops and an all_hops timeline

The reply sample now has one resolved and one unresolved relay hop, which is
what lets structureOf derive name/pk as nullable. The paths example switches to
the pipeline form with a "direct" fallback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `PlaceholderDrop.toJSON()`

**Files:**
- Modify: `src/shared/macros/placeholder.ts:3-17`
- Test: `tests/unit/macros/render.test.ts`

**Interfaces:**
- Produces: `PlaceholderDrop.toJSON(): string` — makes `{{ x | json }}` render `"?"` instead of `{"text":"?"}`.

- [ ] **Step 1: Write the failing test**

Append to the `describe('renderTemplate', …)` block in `tests/unit/macros/render.test.ts`:

```ts
  it('serialises an empty value as the placeholder under json, not the drop internals', () => {
    const c = { ...ctx(), sender_pos: null };
    const r = renderTemplate(engine, '{{ sender_pos | json }}', c, { placeholder: '?' });
    expect(r).toEqual({ ok: true, text: '"?"' });
  });

  it('keeps bare output and property access on an empty value unchanged', () => {
    const c = { ...ctx(), sender_pos: null };
    expect(renderTemplate(engine, '{{ sender_pos }}', c, { placeholder: '?' })).toEqual({ ok: true, text: '?' });
    expect(renderTemplate(engine, '{{ sender_pos.lat }}', c, { placeholder: '?' })).toEqual({ ok: true, text: '?' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/macros/render.test.ts`
Expected: FAIL — received `{"text":"?"}` instead of `"?"`.

- [ ] **Step 3: Add `toJSON`**

In `src/shared/macros/placeholder.ts`, add this method to `PlaceholderDrop`, after `toString()`:

```ts
  // JSON.stringify walks own enumerable fields and would otherwise leak the
  // `text` field name through the `json` / `inspect` filters. valueOf() is not
  // consulted by those filters, so toJSON is the only hook that works.
  toJSON(): string {
    return this.text;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/macros/render.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/macros/placeholder.ts tests/unit/macros/render.test.ts
git commit -m "$(cat <<'EOF'
fix(macros): stop json/inspect leaking PlaceholderDrop internals

{{ x | json }} on an absent value rendered {"text":"?"}. toJSON() makes it "?".

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `structure.ts`

**Files:**
- Create: `src/shared/macros/structure.ts`
- Modify: `src/shared/macros/index.ts`
- Test: `tests/unit/macros/structure.test.ts`

**Interfaces:**
- Consumes: `isPlaceholder` from `./placeholder`; the Task 2 sample context.
- Produces:
  - `type ScalarType = 'string'|'number'|'boolean'|'null'|'unknown'`
  - `type StructureNode = {kind:'scalar';type:ScalarType;nullable?:boolean} | {kind:'object';fields:StructureField[]} | {kind:'array';length:number;element:StructureNode|null}`
  - `interface StructureField { name: string; node: StructureNode; sample?: string }`
  - `type PathSegment = string | number | PathSegment[]`
  - `type ResolveResult = {ok:true;node:StructureNode} | {ok:false;reason:'missing';failedAt:number} | {ok:false;reason:'dynamic'} | {ok:false;reason:'empty-sample';failedAt:number}`
  - `structureOf(value: unknown): StructureNode`
  - `resolvePath(root: StructureNode, path: PathSegment[]): ResolveResult`
  - `fieldsAt(root: StructureNode, path: PathSegment[]): string[] | null`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/macros/structure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSampleContext } from '../../../src/shared/macros/manifest';
import { PlaceholderDrop } from '../../../src/shared/macros/placeholder';
import { fieldsAt, resolvePath, structureOf } from '../../../src/shared/macros/structure';

const root = () => structureOf(buildSampleContext());

describe('structureOf', () => {
  it('describes scalars with their sample value', () => {
    const n = structureOf({ a: 'hi', b: 2, c: true, d: null });
    expect(n.kind).toBe('object');
    if (n.kind !== 'object') return;
    expect(n.fields.map((f) => [f.name, f.node.kind === 'scalar' ? f.node.type : '?'])).toEqual([
      ['a', 'string'],
      ['b', 'number'],
      ['c', 'boolean'],
      ['d', 'null'],
    ]);
    expect(n.fields[0].sample).toBe('"hi"');
    expect(n.fields[1].sample).toBe('2');
  });

  it('merges array element shapes across all items so nullability survives', () => {
    const n = structureOf([{ a: 'x' }, { a: null }]);
    expect(n.kind).toBe('array');
    if (n.kind !== 'array' || n.element?.kind !== 'object') return;
    const a = n.element.fields[0].node;
    expect(a).toMatchObject({ kind: 'scalar', type: 'string', nullable: true });
  });

  it('keeps a key present on only some elements', () => {
    const n = structureOf([{ a: 1 }, { b: 2 }]);
    if (n.kind !== 'array' || n.element?.kind !== 'object') throw new Error('shape');
    expect(n.element.fields.map((f) => f.name).sort()).toEqual(['a', 'b']);
  });

  it('reports an empty array as element null', () => {
    expect(structureOf([])).toEqual({ kind: 'array', length: 0, element: null });
  });

  it('maps a PlaceholderDrop to unknown rather than an object', () => {
    expect(structureOf(new PlaceholderDrop('?'))).toEqual({ kind: 'scalar', type: 'unknown' });
  });

  it('degrades non-JSON values to unknown instead of throwing', () => {
    const n = structureOf({ d: new Date(0), r: /x/, f: () => 1 });
    if (n.kind !== 'object') throw new Error('shape');
    for (const f of n.fields) expect(f.node).toMatchObject({ kind: 'scalar', type: 'unknown' });
  });

  it('derives hop name and pk as nullable from the real sample', () => {
    const hops = resolvePath(root(), ['paths', 'first', 'hops']);
    expect(hops.ok).toBe(true);
    if (!hops.ok || hops.node.kind !== 'array' || hops.node.element?.kind !== 'object') throw new Error('shape');
    const byName = Object.fromEntries(hops.node.element.fields.map((f) => [f.name, f.node]));
    expect(byName.name).toMatchObject({ kind: 'scalar', type: 'string', nullable: true });
    expect(byName.pk).toMatchObject({ kind: 'scalar', type: 'string', nullable: true });
    expect(byName.short_id).toMatchObject({ kind: 'scalar', type: 'string' });
  });
});

describe('resolvePath', () => {
  it('walks object fields', () => {
    const r = resolvePath(root(), ['my_pos', 'lat']);
    expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'number' });
  });

  it('steps through first/last into the array element', () => {
    const r = resolvePath(root(), ['paths', 'first', 'hops', 'last', 'short_id']);
    expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'string' });
  });

  it('steps through a numeric index, as a number or a numeric string', () => {
    expect(resolvePath(root(), ['paths', 0, 'hops', 1, 'short_id']).ok).toBe(true);
    expect(resolvePath(root(), ['paths', '0', 'hops', '1', 'short_id']).ok).toBe(true);
  });

  it('resolves size on arrays, strings and objects', () => {
    for (const p of [['paths', 'size'], ['message_body', 'size'], ['my_pos', 'size']]) {
      const r = resolvePath(root(), p as string[]);
      expect(r.ok && r.node).toMatchObject({ kind: 'scalar', type: 'number' });
    }
  });

  it('reports the index of the first missing segment', () => {
    const r = resolvePath(root(), ['paths', 'first', 'hops', 'first', 'nope']);
    expect(r).toEqual({ ok: false, reason: 'missing', failedAt: 4 });
  });

  it('reports a dynamic segment instead of guessing', () => {
    expect(resolvePath(root(), ['paths', ['a', 'b']])).toEqual({ ok: false, reason: 'dynamic' });
  });

  it('reports empty-sample rather than missing when an array has no elements', () => {
    const r = resolvePath(structureOf({ xs: [] }), ['xs', 'first', 'anything']);
    expect(r).toEqual({ ok: false, reason: 'empty-sample', failedAt: 1 });
  });
});

describe('fieldsAt', () => {
  it('lists the fields of an array element', () => {
    expect(fieldsAt(root(), ['paths', 'first', 'hops'])).toEqual(['kind', 'short_id', 'name', 'pk']);
  });

  it('lists the fields of an object', () => {
    expect(fieldsAt(root(), ['my_pos'])).toEqual(['lat', 'lon']);
  });

  it('returns null for a scalar or an unresolvable path', () => {
    expect(fieldsAt(root(), ['my_name'])).toBeNull();
    expect(fieldsAt(root(), ['nope'])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/macros/structure.test.ts`
Expected: FAIL — `Cannot find module '../../../src/shared/macros/structure'`.

- [ ] **Step 3: Implement `structure.ts`**

Create `src/shared/macros/structure.ts`:

```ts
import { isPlaceholder } from './placeholder';

export type ScalarType = 'string' | 'number' | 'boolean' | 'null' | 'unknown';

export type StructureNode =
  | { kind: 'scalar'; type: ScalarType; nullable?: boolean }
  | { kind: 'object'; fields: StructureField[] }
  | { kind: 'array'; length: number; element: StructureNode | null };

export interface StructureField {
  name: string;
  node: StructureNode;
  /** A displayable rendering of the sample value, when there is one. */
  sample?: string;
}

/** Mirrors liquidjs's SegmentArray: index segments arrive as numbers (from the
 *  analysis API) or numeric strings (from a parsed PropertyAccessToken), and
 *  dynamic subscripts (`a[b.c]`) as nested arrays. */
export type PathSegment = string | number | PathSegment[];

export type ResolveResult =
  | { ok: true; node: StructureNode }
  | { ok: false; reason: 'missing'; failedAt: number }
  | { ok: false; reason: 'dynamic' }
  | { ok: false; reason: 'empty-sample'; failedAt: number };

function isObjectLike(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v) || isPlaceholder(v)) return false;
  if (v instanceof Date || v instanceof Map || v instanceof Set || v instanceof RegExp) return false;
  return true;
}

function scalarTypeOf(v: unknown): ScalarType {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'unknown';
}

function sampleOf(v: unknown): string | undefined {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

export function structureOf(value: unknown): StructureNode {
  if (Array.isArray(value)) {
    return { kind: 'array', length: value.length, element: mergeAll(value.map(structureOf)) };
  }
  if (isObjectLike(value)) {
    const fields: StructureField[] = Object.entries(value).map(([name, v]) => {
      const sample = sampleOf(v);
      return sample === undefined ? { name, node: structureOf(v) } : { name, node: structureOf(v), sample };
    });
    return { kind: 'object', fields };
  }
  return { kind: 'scalar', type: scalarTypeOf(value) };
}

function mergeAll(nodes: StructureNode[]): StructureNode | null {
  if (nodes.length === 0) return null;
  return nodes.reduce(mergeNodes);
}

function mergeNodes(a: StructureNode, b: StructureNode): StructureNode {
  if (a.kind === 'object' && b.kind === 'object') {
    const byName = new Map<string, StructureField>();
    for (const f of a.fields) byName.set(f.name, f);
    for (const f of b.fields) {
      const prev = byName.get(f.name);
      if (!prev) {
        byName.set(f.name, f);
        continue;
      }
      const merged: StructureField = { name: f.name, node: mergeNodes(prev.node, f.node) };
      const sample = prev.sample ?? f.sample;
      byName.set(f.name, sample === undefined ? merged : { ...merged, sample });
    }
    return { kind: 'object', fields: [...byName.values()] };
  }
  if (a.kind === 'array' && b.kind === 'array') {
    const element = a.element && b.element ? mergeNodes(a.element, b.element) : (a.element ?? b.element);
    return { kind: 'array', length: Math.max(a.length, b.length), element };
  }
  if (a.kind === 'scalar' && b.kind === 'scalar') return mergeScalars(a, b);
  // An object merged with a null sibling stays an object; anything else mixed is
  // not describable as one shape.
  if (a.kind === 'scalar' && a.type === 'null') return b;
  if (b.kind === 'scalar' && b.type === 'null') return a;
  return { kind: 'scalar', type: 'unknown' };
}

function mergeScalars(
  a: { kind: 'scalar'; type: ScalarType; nullable?: boolean },
  b: { kind: 'scalar'; type: ScalarType; nullable?: boolean },
): StructureNode {
  const nullable = a.nullable === true || b.nullable === true;
  if (a.type === b.type) return nullable ? { kind: 'scalar', type: a.type, nullable } : { kind: 'scalar', type: a.type };
  if (a.type === 'null') return { kind: 'scalar', type: b.type, nullable: true };
  if (b.type === 'null') return { kind: 'scalar', type: a.type, nullable: true };
  return nullable ? { kind: 'scalar', type: 'unknown', nullable } : { kind: 'scalar', type: 'unknown' };
}

function asIndex(seg: string | number): number | null {
  if (typeof seg === 'number') return Number.isInteger(seg) ? seg : null;
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/** One property step. Returns the reached node, or a marker for why it failed. */
function step(node: StructureNode, seg: string | number): StructureNode | 'missing' | 'empty-sample' {
  // `size` is a Liquid pseudo-property on arrays, strings and objects alike.
  if (seg === 'size') {
    if (node.kind === 'array' || node.kind === 'object') return { kind: 'scalar', type: 'number' };
    if (node.kind === 'scalar' && node.type === 'string') return { kind: 'scalar', type: 'number' };
    return 'missing';
  }
  if (node.kind === 'array') {
    const indexed = seg === 'first' || seg === 'last' || asIndex(seg) !== null;
    if (!indexed) return 'missing';
    return node.element ?? 'empty-sample';
  }
  if (node.kind === 'object') {
    return node.fields.find((f) => f.name === seg)?.node ?? 'missing';
  }
  return 'missing';
}

export function resolvePath(root: StructureNode, path: PathSegment[]): ResolveResult {
  let node = root;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (Array.isArray(seg)) return { ok: false, reason: 'dynamic' };
    const next = step(node, seg);
    if (next === 'missing') return { ok: false, reason: 'missing', failedAt: i };
    if (next === 'empty-sample') return { ok: false, reason: 'empty-sample', failedAt: i };
    node = next;
  }
  return { ok: true, node };
}

/** Field names reachable at a path — of the object there, or of an array's
 *  element. Null when the path doesn't resolve or lands on a scalar. */
export function fieldsAt(root: StructureNode, path: PathSegment[]): string[] | null {
  const r = resolvePath(root, path);
  if (!r.ok) return null;
  if (r.node.kind === 'object') return r.node.fields.map((f) => f.name);
  if (r.node.kind === 'array' && r.node.element?.kind === 'object') return r.node.element.fields.map((f) => f.name);
  return null;
}
```

- [ ] **Step 4: Export from the barrel**

In `src/shared/macros/index.ts`, add after the `renderTemplate` export line:

```ts
export {
  fieldsAt,
  type PathSegment,
  type ResolveResult,
  resolvePath,
  type ScalarType,
  structureOf,
  type StructureField,
  type StructureNode,
} from './structure';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/macros/structure.test.ts`
Expected: PASS (16 tests).

Run: `npx tsc --noEmit && npx biome check src tests`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/macros/structure.ts src/shared/macros/index.ts tests/unit/macros/structure.test.ts
git commit -m "$(cat <<'EOF'
feat(macros): derive a shape tree from the sample context

structureOf walks a runtime value into a describable shape; resolvePath walks a
Liquid dotted path against it, handling first/last/size and numeric indices, and
distinguishing a missing key from an empty sample.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `lint.ts`

**Files:**
- Create: `src/shared/macros/lint.ts`
- Modify: `src/shared/macros/index.ts`
- Test: `tests/unit/macros/lint.test.ts`

**Interfaces:**
- Consumes: `createMacroEngine`, `buildSampleContext`, `structureOf`/`resolvePath`/`fieldsAt`/`PathSegment`/`StructureNode` from Task 4.
- Produces: `interface MacroWarning { kind: 'unknown-property'; message: string; name: string; suggestion?: string; line?: number; col?: number }`; `lintTemplate(template: string): MacroWarning[]`.

**Background — verified liquidjs shapes this walker depends on:**
```
engine.parse('{{ paths.first.hops | map: "pk" }}')[0]     → Output
  .value                                                   → Value { initial, filters }
  .value.initial.postfix[0]                                → PropertyAccessToken
  .value.initial.postfix[0].props.map(p => p.getText())    → ['paths','first','hops']   (indices arrive as '0')
  .value.filters[0]                                        → { name:'map', args:[QuotedToken], token, ... }
  .value.filters[0].args[0].content                        → 'pk'   (unquoted)
  .value.filters[0].args[0].begin / .end                   → 27 / 31  (whole-template offsets)
TypeGuards.isQuotedToken / isPropertyAccessToken           → importable from 'liquidjs'
```
The engine **must** be `createMacroEngine` — a bare `new Liquid(...)` throws `undefined filter: distance` at parse time under `strictFilters: true`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/macros/lint.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/macros/lint.test.ts`
Expected: FAIL — `Cannot find module '../../../src/shared/macros/lint'`.

- [ ] **Step 3: Implement `lint.ts`**

Create `src/shared/macros/lint.ts`:

```ts
import { type Liquid, type Token, TypeGuards } from 'liquidjs';
import { createMacroEngine } from './engine';
import { buildSampleContext } from './manifest';
import { fieldsAt, type PathSegment, resolvePath, type StructureNode, structureOf } from './structure';

export interface MacroWarning {
  kind: 'unknown-property';
  message: string;
  /** The offending path or filter key, e.g. 'paths.first.hops.pk' or 'pubkey'. */
  name: string;
  suggestion?: string;
  line?: number;
  col?: number;
}

// Same lazy cached engine as validate.ts. It must be createMacroEngine, not a
// bare Liquid: strictFilters makes `parse` throw on distance/bearing/unit.
let cached: Liquid | null = null;
function engine(): Liquid {
  if (!cached) cached = createMacroEngine({ defaultDistanceUnit: 'metric' });
  return cached;
}

/** Filters whose first quoted argument names a property of the piped-in array's
 *  element. sort / sort_natural / sum take it optionally. */
const PROPERTY_FILTERS = new Set(['map', 'where', 'sort', 'sort_natural', 'group_by', 'sum']);

/** Guesses edit distance cannot reach. Consulted before Levenshtein — the
 *  headline case is lev('pubkey','pk') = 4, further than 'kind' or 'name'. */
const ALIASES: Record<string, string> = {
  pubkey: 'pk',
  public_key: 'pk',
  publickey: 'pk',
  key: 'pk',
  hash: 'short_id',
  prefix: 'short_id',
  shortid: 'short_id',
  short: 'short_id',
  label: 'name',
  callsign: 'name',
};

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const curr = [i, ...Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[cols - 1];
}

function suggest(bad: string, available: string[]): string | undefined {
  const alias = ALIASES[bad.toLowerCase()];
  if (alias && available.includes(alias)) return alias;
  let best: string | undefined;
  let bestDistance = 3; // bounded: only near-misses
  for (const candidate of available) {
    const d = levenshtein(bad.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

function warn(name: string, available: string[], where?: { line: number; col: number }): MacroWarning {
  const suggestion = suggest(name, available);
  const known = available.length > 0 ? ` (${available.join(', ')})` : '';
  const hint = suggestion ? ` Did you mean ${suggestion}?` : '';
  return {
    kind: 'unknown-property',
    name,
    message: `no such property "${name}".${hint}${known}`,
    ...(suggestion ? { suggestion } : {}),
    ...(where ?? {}),
  };
}

/** 1-based line/col for a whole-template character offset. */
function lineCol(template: string, offset: number): { line: number; col: number } {
  const before = template.slice(0, offset);
  const line = before.split('\n').length;
  const col = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, col };
}

// ---------------------------------------------------------------- check (a)

function checkVariablePaths(eng: Liquid, template: string, root: StructureNode): MacroWarning[] {
  let segments: PathSegment[][];
  try {
    // globalVariableSegmentsSync, NOT variableSegmentsSync: the plain variant
    // also returns {% assign %} locals, {% for %} loop variables and `forloop`.
    segments = eng.globalVariableSegmentsSync(template) as PathSegment[][];
  } catch {
    return [];
  }
  const out: MacroWarning[] = [];
  for (const path of segments) {
    const r = resolvePath(root, path);
    if (r.ok || r.reason !== 'missing') continue;
    const bad = path[r.failedAt];
    if (typeof bad !== 'string') continue;
    const available = fieldsAt(root, path.slice(0, r.failedAt)) ?? [];
    const full = path.slice(0, r.failedAt + 1).join('.');
    out.push({ ...warn(bad, available), name: full, message: `${full} — ${warn(bad, available).message}` });
  }
  return out;
}

// ---------------------------------------------------------------- check (b)

/** The parse-tree slices this walker reads. liquidjs types `Output.value` loosely,
 *  so these mirror the verified runtime shape. */
interface ParsedFilter {
  name: string;
  /** Positional tokens, plus `[key, Token]` pairs for keyword args. */
  args: (Token | [string, Token])[];
}

interface ParsedValue {
  initial?: { postfix?: Token[] };
  filters?: ParsedFilter[];
}

function initialSegments(value: ParsedValue): PathSegment[] | null {
  const head = value.initial?.postfix?.[0];
  // A literal head (`{{ "lit" | upcase }}`) is not a variable path — skip it.
  if (!head || !TypeGuards.isPropertyAccessToken(head)) return null;
  // props are ValueToken | IdentifierToken, both Tokens, so getText() is typed.
  // Indices arrive as numeric strings here ('0'), which resolvePath accepts.
  return head.props.map((p) => p.getText());
}

function firstQuotedArg(filter: ParsedFilter): { key: string; begin: number } | null {
  for (const arg of filter.args) {
    if (Array.isArray(arg)) continue; // keyword pair, e.g. `allow_false: true`
    if (!TypeGuards.isQuotedToken(arg)) continue;
    return { key: arg.content, begin: arg.begin };
  }
  return null;
}

/** The element shape a property-filter key is checked against. */
function elementOf(node: StructureNode | null): StructureNode | null {
  if (node?.kind !== 'array') return null;
  return node.element;
}

/** Shape transforms this design needs. Anything else returns null, which
 *  abandons check (b) for the rest of the chain rather than guessing. */
function advance(filterName: string, key: string | null, node: StructureNode | null): StructureNode | null {
  if (node === null) return null;
  switch (filterName) {
    case 'where':
    case 'reject':
    case 'sort':
    case 'sort_natural':
    case 'uniq':
    case 'compact':
    case 'reverse':
      return node;
    case 'first':
    case 'last':
      return elementOf(node);
    case 'map': {
      const element = elementOf(node);
      if (!key || element?.kind !== 'object') return null;
      const field = element.fields.find((f) => f.name === key);
      return field ? { kind: 'array', length: 1, element: field.node } : null;
    }
    case 'group_by': {
      const element = elementOf(node);
      if (!element) return null;
      return {
        kind: 'array',
        length: 1,
        element: {
          kind: 'object',
          fields: [
            { name: 'name', node: { kind: 'scalar', type: 'string' } },
            { name: 'items', node: { kind: 'array', length: 1, element } },
          ],
        },
      };
    }
    default:
      return null;
  }
}

function checkFilterKeys(eng: Liquid, template: string, root: StructureNode): MacroWarning[] {
  let templates: ReturnType<Liquid['parse']>;
  try {
    templates = eng.parse(template);
  } catch {
    return [];
  }
  const out: MacroWarning[] = [];
  for (const tpl of templates) {
    const value = (tpl as unknown as { value?: ParsedValue }).value;
    if (!value || !Array.isArray(value.filters)) continue;
    const segments = initialSegments(value);
    if (!segments) continue;
    const start = resolvePath(root, segments);
    if (!start.ok) continue; // check (a) reports it, or the sample cannot tell
    let node: StructureNode | null = start.node;
    for (const filter of value.filters) {
      const quoted = firstQuotedArg(filter);
      if (PROPERTY_FILTERS.has(filter.name) && quoted) {
        const element = elementOf(node);
        if (element?.kind === 'object') {
          const available = element.fields.map((f) => f.name);
          if (!available.includes(quoted.key)) {
            out.push(warn(quoted.key, available, lineCol(template, quoted.begin)));
          }
        }
      }
      node = advance(filter.name, quoted?.key ?? null, node);
      if (node === null) break;
    }
  }
  return out;
}

/**
 * Non-blocking property check for a macro template, against the reply sample.
 *
 * Deliberately mirrors validateTemplate(template) and takes no context: linting
 * against sendContext() (where `paths` is []) would flag the manifest's own
 * flagship example the moment the author toggled the preview.
 *
 * Known gaps: dynamic paths (`a[b.c]`) are skipped rather than guessed at;
 * filters inside {% %} tags are not walked; a key present on only some array
 * elements is accepted; an empty sample array disables checking below it.
 */
export function lintTemplate(template: string): MacroWarning[] {
  const eng = engine();
  const root = structureOf(buildSampleContext());
  return [...checkVariablePaths(eng, template, root), ...checkFilterKeys(eng, template, root)];
}
```

- [ ] **Step 4: Export from the barrel**

In `src/shared/macros/index.ts`, add:

```ts
export { lintTemplate, type MacroWarning } from './lint';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/macros/lint.test.ts`
Expected: PASS (14 tests).

Run: `npx vitest run && npx tsc --noEmit && npx biome check src tests`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/macros/lint.ts src/shared/macros/index.ts tests/unit/macros/lint.test.ts
git commit -m "$(cat <<'EOF'
feat(macros): warn on property names the sample context does not have

Checks variable paths (via globalVariableSegmentsSync, so template locals don't
false-positive) and the quoted key args of map/where/sort/group_by/sum, walking
the filter chain so later stages check the right shape. Total by construction —
returns [] for anything that doesn't parse.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Single-column studio layout

**Files:**
- Modify: `src/renderer/panels/macros/MacroStudio.tsx:102-207`
- Modify: `src/renderer/panels/macros/studio/PreviewPane.tsx:35`
- Test: `tests/component/macros/MacroStudio.test.tsx`

**Interfaces:**
- Produces: no API change — layout only. `PreviewPane` keeps its current props.

- [ ] **Step 1: Write the failing test**

Append to the `describe('MacroStudio', …)` block in `tests/component/macros/MacroStudio.test.tsx`:

```ts
  it('renders the editor and the preview in a single stacked column', () => {
    const { container } = render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    expect(screen.getByTestId('macro-editor')).toBeTruthy();
    expect(screen.getByTestId('preview-output')).toBeTruthy();
    // No two-column grid: the body is a flex column.
    expect(container.querySelector('.lg\\:grid-cols-\\[1\\.1fr_1fr\\]')).toBeNull();
    const editor = screen.getByTestId('macro-editor');
    const preview = screen.getByTestId('preview-output');
    // The preview follows the editor in document order.
    expect(editor.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/macros/MacroStudio.test.tsx`
Expected: FAIL — the grid selector still matches.

- [ ] **Step 3: Restructure the studio body**

In `src/renderer/panels/macros/MacroStudio.tsx`, replace line 102:

```tsx
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
```

with:

```tsx
      <div className="flex min-h-0 flex-1 flex-col">
```

Replace line 104 (the editor column's opening tag):

```tsx
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-cs-border p-4 lg:border-r">
```

with:

```tsx
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
```

Replace lines 197-206 (the preview column comment and wrapper) with:

```tsx
        {/* Preview — stacked under the editor. The Reference lives in the right
            rail; the preview stays here so it keeps receiving validation and
            lint warnings as props, and can't be unmounted by collapsing the rail. */}
        <div className="flex max-h-[45%] shrink-0 flex-col border-t border-cs-border">
          <PreviewPane
            value={st.value}
            mode={st.previewMode}
            onModeChange={st.setPreviewMode}
            distanceUnit={distanceUnit}
            validation={validation}
          />
        </div>
```

- [ ] **Step 4: Let PreviewPane size to its container**

In `src/renderer/panels/macros/studio/PreviewPane.tsx`, replace line 35:

```tsx
    <div className="flex h-full min-h-0 flex-col bg-cs-bg-2">
```

with:

```tsx
    <div className="flex min-h-0 flex-col bg-cs-bg-2">
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/macros`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/macros/MacroStudio.tsx src/renderer/panels/macros/studio/PreviewPane.tsx tests/component/macros/MacroStudio.test.tsx
git commit -m "$(cat <<'EOF'
refactor(macros): single-column studio with the preview under the editor

Frees the full centre width for the template editor. The preview stays a child
of MacroStudio so validation (and the incoming lint warnings) reach it as props.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Surface the lint + derive the preview caption

**Files:**
- Modify: `src/renderer/panels/macros/MacroStudio.tsx`
- Modify: `src/renderer/panels/macros/studio/PreviewPane.tsx:1-32`, `:63-67`, `:114-130`
- Test: `tests/component/macros/MacroStudio.test.tsx`

**Interfaces:**
- Consumes: `lintTemplate`, `MacroWarning` (Task 5).
- Produces: `PreviewPaneProps` gains `warnings: MacroWarning[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/component/macros/MacroStudio.test.tsx`:

```ts
  it('shows a non-blocking warning for an unknown filter key, and still allows saving', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-name'), { target: { value: 'Path' } });
    fireEvent.change(screen.getByTestId('macro-editor'), {
      target: { value: '{{ paths.first.hops | map: "pubkey" }}' },
    });
    expect(screen.getByTestId('preview-warnings').textContent).toContain('pubkey');
    expect(screen.getByTestId('preview-warnings').textContent).toContain('pk');
    expect((screen.getByRole('button', { name: /save macro/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows no warnings panel for a clean template', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId('macro-editor'), {
      target: { value: '{{ paths.first.hops | map: "short_id" }}' },
    });
    expect(screen.queryByTestId('preview-warnings')).toBeNull();
  });

  it('derives the preview caption from the sample context instead of hardcoding it', () => {
    render(<MacroStudio client={client} macro={existing} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('preview-mode-reply'));
    const caption = screen.getByTestId('preview-caption').textContent ?? '';
    expect(caption).toContain('Alice');
    expect(caption).toContain('2 hops'); // the sample path has 2 relay hops
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/macros/MacroStudio.test.tsx`
Expected: FAIL — no `preview-warnings` / `preview-caption` test ids.

- [ ] **Step 3: Compute and pass warnings**

In `src/renderer/panels/macros/MacroStudio.tsx`, change the import on line 8 to:

```tsx
import { lintTemplate, MACRO_VARIABLES, validateTemplate } from '../../../shared/macros';
```

Add below line 44 (`const validation = …`):

```tsx
  // Non-blocking: warnings never gate canSave, unlike `validation`.
  const warnings = useMemo(() => lintTemplate(st.value), [st.value]);
```

Add `warnings={warnings}` to the `<PreviewPane …>` call added in Task 6, after `validation={validation}`.

- [ ] **Step 4: Render warnings and derive the caption**

In `src/renderer/panels/macros/studio/PreviewPane.tsx`:

Replace the type import on line 4 with these two (`MacroWarning` lives in `lint.ts`, not `types.ts`):

```tsx
import type { MacroWarning } from '../../../../shared/macros/lint';
import type { DistanceUnit, ValidateResult } from '../../../../shared/macros/types';
```

Add to `PreviewPaneProps` (after `validation: ValidateResult;`):

```tsx
  warnings: MacroWarning[];
```

and to the destructured params on line 23:

```tsx
export function PreviewPane({ value, mode, onModeChange, distanceUnit, validation, warnings }: PreviewPaneProps) {
```

Replace line 25 with a memoised context:

```tsx
  const ctx = useMemo(() => (mode === 'reply' ? replyContext() : sendContext()), [mode]);
```

Replace lines 63-67 (the hardcoded caption) with:

```tsx
        <p className="mb-2 text-[10px] text-cs-text-dim" data-testid="preview-caption">
          {mode === 'reply'
            ? `Replying to ${ctx.sender_name ?? '—'} · ${ctx.rssi ?? '—'}dBm / ${ctx.snr ?? '—'} snr · ${
                ctx.paths[0]?.length ?? 0
              } hops`
            : `New message to ${ctx.peer_name ?? '—'} · always-available variables only`}
        </p>
```

Insert this block immediately after the validation `<div className="mt-3">…</div>` that ends at line 130:

```tsx
        {warnings.length > 0 && (
          <div className="mt-3 space-y-1" data-testid="preview-warnings">
            {warnings.map((w) => (
              <div key={`${w.name}-${w.line ?? 0}-${w.col ?? 0}`} className="flex items-start gap-1 text-[11px] text-cs-warn">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/macros && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/panels/macros/MacroStudio.tsx src/renderer/panels/macros/studio/PreviewPane.tsx tests/component/macros/MacroStudio.test.tsx
git commit -m "$(cat <<'EOF'
feat(macros): show lint warnings in the preview and derive its caption

Warnings render below validation in cs-warn and never gate canSave. The context
caption is derived from the sample instead of a hardcoded string that no longer
matches the sample path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Document `json` / `inspect`, fix the `map` stub

**Files:**
- Modify: `src/renderer/panels/macros/studio/ReferencePanel.tsx:11-42`
- Test: `tests/component/macros/MacroReferenceRail.test.tsx`

**Interfaces:**
- Produces: no API change. `STANDARD_FILTERS` gains `json` and `inspect`; `FILTER_INSERT` gains their stubs and corrects `map`'s.

- [ ] **Step 1: Write the failing test**

Append to `tests/component/macros/MacroReferenceRail.test.tsx`:

```ts
  it('documents the json and inspect debug filters', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText: vi.fn() } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /filters/i }));
    expect(screen.getByRole('button', { name: /insert json filter/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /insert inspect filter/i })).toBeTruthy();
  });

  it('inserts the json stub with an indent argument', () => {
    const insertText = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /insert json filter/i }));
    expect(insertText).toHaveBeenCalledWith(' | json: 2');
  });

  it('suggests short_id for map, the field that is always populated', () => {
    const insertText = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /filters/i }));
    fireEvent.click(screen.getByRole('button', { name: /insert map filter/i }));
    expect(insertText).toHaveBeenCalledWith(' | map: "short_id"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/macros/MacroReferenceRail.test.tsx`
Expected: FAIL — no json/inspect rows; `map` stub is `"name"`.

- [ ] **Step 3: Update the filter docs**

In `src/renderer/panels/macros/studio/ReferencePanel.tsx`, replace line 18:

```ts
  map: ' | map: "name"',
```

with:

```ts
  map: ' | map: "short_id"',
```

Add to `FILTER_INSERT` (after the `size` entry on line 21):

```ts
  json: ' | json: 2',
  inspect: ' | inspect',
```

Append to `STANDARD_FILTERS` (after the `size` entry on line 41):

```ts
  {
    name: 'json',
    signature: '{{ value | json: 2 }}',
    description: 'Dump a value as JSON — use it to discover an object’s fields',
  },
  {
    name: 'inspect',
    signature: '{{ value | inspect }}',
    description: 'Like json, but prints [Circular] instead of failing on cycles',
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project dom tests/component/macros/MacroReferenceRail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/panels/macros/studio/ReferencePanel.tsx tests/component/macros/MacroReferenceRail.test.tsx
git commit -m "$(cat <<'EOF'
feat(macros): document the json and inspect debug filters

Both already worked under strictFilters but appeared in none of the three doc
lists. Also points map's insert stub at short_id — name is null on unresolved
relay hops.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Hover cards on Reference rows

**Files:**
- Create: `src/renderer/panels/macros/studio/VariableHoverCard.tsx`
- Create: `src/renderer/panels/macros/studio/FilterHoverCard.tsx`
- Modify: `src/renderer/panels/macros/studio/ReferencePanel.tsx:69-84`, `:107-118`, `:176-199`
- Modify: `src/renderer/panels/macros/MacroStudio.tsx:183-194` (quick-var chips)
- Test: `tests/component/macros/VariableHoverCard.test.tsx`, `tests/component/macros/MacroReferenceRail.test.tsx`, `tests/component/macros/MacroStudio.test.tsx`

**Interfaces:**
- Consumes: `structureOf`, `resolvePath`, `StructureNode` (Task 4); `MacroVariable`, `MacroFilterDoc`.
- Produces:
  - `VariableHoverCard({ variable, structure }: { variable: MacroVariable; structure: StructureNode | null })`
  - `FilterHoverCard({ name, description, signature, example }: { name: string; description: string; signature: string; example?: string })`
  - `InsertRow` gains `hoverCard?: React.ReactNode`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/macros/VariableHoverCard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterHoverCard } from '@/panels/macros/studio/FilterHoverCard';
import { VariableHoverCard } from '@/panels/macros/studio/VariableHoverCard';
import { buildSampleContext, MACRO_VARIABLES, resolvePath, structureOf } from '../../../src/shared/macros';

const variable = (name: string) => {
  const v = MACRO_VARIABLES.find((x) => x.name === name);
  if (!v) throw new Error(`no variable ${name}`);
  return v;
};

const structureFor = (name: string) => {
  const r = resolvePath(structureOf(buildSampleContext()), [name]);
  return r.ok ? r.node : null;
};

describe('VariableHoverCard', () => {
  it('shows the name, type, availability and the untruncated description', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getByText('paths')).toBeTruthy();
    expect(screen.getByText(/reply only/i)).toBeTruthy();
    expect(screen.getByText(/repeaters between the sender and you/i)).toBeTruthy();
  });

  it('shows the example, which no other surface renders', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getByText(/default: "direct"/)).toBeTruthy();
  });

  it('lists the path fields and drills one level into hops', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getByText('hops')).toBeTruthy();
    expect(screen.getByText('all_hops')).toBeTruthy();
    // `short_id` appears under both hops and all_hops — the point is that a
    // one-level card would show neither.
    expect(screen.getAllByText('short_id').length).toBeGreaterThan(0);
  });

  it('marks a field the sample proves can be null', () => {
    render(<VariableHoverCard variable={variable('paths')} structure={structureFor('paths')} />);
    expect(screen.getAllByText('string|null').length).toBeGreaterThan(0);
  });

  it('renders a scalar variable without a structure section', () => {
    render(<VariableHoverCard variable={variable('my_name')} structure={structureFor('my_name')} />);
    expect(screen.getByText('my_name')).toBeTruthy();
    expect(screen.queryByText(/^STRUCTURE$/i)).toBeNull();
  });
});

describe('FilterHoverCard', () => {
  it('shows signature and description, and the example when given', () => {
    render(
      <FilterHoverCard
        name="distance"
        description="Great-circle distance in metres between two positions"
        signature="{{ a | distance: b }}"
        example="{{ my_pos | distance: peer_pos }}"
      />,
    );
    expect(screen.getByText('distance')).toBeTruthy();
    expect(screen.getByText('{{ a | distance: b }}')).toBeTruthy();
    expect(screen.getByText('{{ my_pos | distance: peer_pos }}')).toBeTruthy();
  });

  it('omits the example section when there is none', () => {
    render(<FilterHoverCard name="first" description="First item of an array" signature="{{ array | first }}" />);
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.queryByText(/^EXAMPLE$/i)).toBeNull();
  });
});
```

Append to `tests/component/macros/MacroReferenceRail.test.tsx`:

```ts
  it('wraps variable rows in a hover-card trigger', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText: vi.fn() } });
    const { container } = render(<MacroReferenceRail />);
    expect(container.querySelector('[data-slot="hover-card-trigger"]')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/macros/VariableHoverCard.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `VariableHoverCard.tsx`**

```tsx
import type { MacroVariable } from '../../../../shared/macros/types';
import type { StructureNode } from '../../../../shared/macros/structure';

const TYPE_LABEL: Record<MacroVariable['type'], string> = {
  string: 'string',
  number: 'number',
  position: 'position',
  array: 'array',
  boolean: 'boolean',
};

/** `string`, or `string|null` when the sample proves the field can be absent. */
function scalarLabel(node: StructureNode): string {
  if (node.kind === 'array') return 'array';
  if (node.kind === 'object') return 'object';
  return node.nullable ? `${node.type}|null` : node.type;
}

function Head({ label }: { label: string }) {
  return <div className="font-mono text-[10px] uppercase tracking-wider text-cs-text-muted">{label}</div>;
}

/** Field names + types, two levels deep. Arrays show their element's fields —
 *  one level of `paths` would only say `hops: array`, which is exactly the dead
 *  end this feature exists to remove. Depth is capped so a card stays readable. */
function Fields({ node, depth = 0 }: { node: StructureNode; depth?: number }) {
  const target = node.kind === 'array' ? node.element : node;
  if (!target || target.kind !== 'object') return null;
  return (
    <div className="flex flex-col gap-0.5">
      {target.fields.map((f) => {
        const nested =
          depth < 1 && (f.node.kind === 'object' || (f.node.kind === 'array' && f.node.element !== null));
        return (
          <div key={f.name} className="flex flex-col" style={{ paddingLeft: depth * 10 }}>
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-cs-text">{f.name}</span>
              <span className="font-mono text-[11px] text-cs-text-muted">{scalarLabel(f.node)}</span>
            </div>
            {nested && <Fields node={f.node} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

export function VariableHoverCard({ variable, structure }: { variable: MacroVariable; structure: StructureNode | null }) {
  const showStructure =
    structure !== null && (structure.kind === 'object' || (structure.kind === 'array' && structure.element !== null));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-cs-accent">{variable.name}</span>
          <span className="rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-text-muted">
            {TYPE_LABEL[variable.type]}
          </span>
          {variable.available === 'reply' && (
            <span className="rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-warn">reply only</span>
          )}
        </div>
        <p className="text-[11px] text-cs-text-muted">{variable.description}</p>
      </div>

      {showStructure && structure && (
        <div className="flex flex-col gap-1">
          <Head label="Structure" />
          <Fields node={structure} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Head label="Example" />
        <code className="break-all font-mono text-[11px] text-cs-text-muted">{variable.example}</code>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `FilterHoverCard.tsx`**

```tsx
function Head({ label }: { label: string }) {
  return <div className="font-mono text-[10px] uppercase tracking-wider text-cs-text-muted">{label}</div>;
}

/** `example` is optional: MeshCore filters are MacroFilterDoc and carry one, the
 *  seven standard-filter rows use a local shape that has no example field. */
export function FilterHoverCard({
  name,
  description,
  signature,
  example,
}: {
  name: string;
  description: string;
  signature: string;
  example?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[12px] text-cs-text">{name}</span>
        <p className="text-[11px] text-cs-text-muted">{description}</p>
      </div>

      <div className="flex flex-col gap-1">
        <Head label="Signature" />
        <code className="break-all font-mono text-[11px] text-cs-text-muted">{signature}</code>
      </div>

      {example && (
        <div className="flex flex-col gap-1">
          <Head label="Example" />
          <code className="break-all font-mono text-[11px] text-cs-text-muted">{example}</code>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the trigger into `InsertRow`**

In `src/renderer/panels/macros/studio/ReferencePanel.tsx`, add these imports at the top:

```tsx
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { buildSampleContext, resolvePath, structureOf } from '../../../../shared/macros';
import { FilterHoverCard } from './FilterHoverCard';
import { VariableHoverCard } from './VariableHoverCard';
```

Replace `InsertRow` (lines 69-84) with:

```tsx
/** The trigger lives INSIDE, wrapping the button: InsertRow spreads no props, so
 *  an asChild trigger placed around it would silently drop the pointer/focus
 *  handlers and the card would never open. */
function InsertRow({
  label,
  onInsert,
  hoverCard,
  children,
}: {
  label: string;
  onInsert: () => void;
  hoverCard?: React.ReactNode;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onInsert}
      className="group flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-cs-bg-3"
    >
      <div className="min-w-0 flex-1">{children}</div>
      <Plus
        className="mt-0.5 size-3 shrink-0 text-cs-text-dim opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
  if (!hoverCard) return button;
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>{button}</HoverCardTrigger>
      <HoverCardContent side="left" align="start" sideOffset={8} collisionPadding={8} className="w-auto max-w-80 p-3">
        {hoverCard}
      </HoverCardContent>
    </HoverCard>
  );
}
```

- [ ] **Step 6: Pass the card bodies from each row**

In `ReferencePanel`, add above `const renderVar = …` (line 107):

```tsx
  const structureRoot = useMemo(() => structureOf(buildSampleContext()), []);
```

In `renderVar` (lines 107-118), add the `hoverCard` prop to `InsertRow`:

```tsx
  const renderVar = (v: MacroVariable) => {
    const unavailable = mode === 'send' && v.available === 'reply';
    const resolved = resolvePath(structureRoot, [v.name]);
    return (
      <InsertRow
        key={v.name}
        label={`Insert ${v.name}`}
        onInsert={() => onInsertVar(v.name)}
        hoverCard={<VariableHoverCard variable={v} structure={resolved.ok ? resolved.node : null} />}
      >
```

(the rest of `renderVar`'s body is unchanged).

In the MeshCore filter rows (lines 176-188), add to `InsertRow`:

```tsx
                hoverCard={
                  <FilterHoverCard
                    name={f.name}
                    description={f.description}
                    signature={f.signature}
                    example={f.example}
                  />
                }
```

In the standard filter rows (lines 190-199), add:

```tsx
                hoverCard={<FilterHoverCard name={f.name} description={f.description} signature={f.signature} />}
```

- [ ] **Step 7: Add hover cards to the Studio quick-var chips**

Append to `tests/component/macros/MacroStudio.test.tsx`:

```ts
  it('wraps the quick-var chips in a hover-card trigger', () => {
    const { container } = render(<MacroStudio client={client} macro={null} onClose={vi.fn()} />);
    expect(container.querySelectorAll('[data-slot="hover-card-trigger"]').length).toBeGreaterThan(0);
    // The chip still inserts on click.
    fireEvent.click(screen.getByRole('button', { name: 'sender_name' }));
    expect((screen.getByTestId('macro-editor') as HTMLTextAreaElement).value).toBe('{{ sender_name }}');
  });
```

Run: `npx vitest run --project dom tests/component/macros/MacroStudio.test.tsx`
Expected: FAIL — no trigger in the studio.

In `src/renderer/panels/macros/MacroStudio.tsx`, add two imports and widen the existing
shared-macros import (it must stay a single statement — Biome's `organizeImports` assist
merges duplicate sources):

```tsx
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  buildSampleContext,
  lintTemplate,
  MACRO_VARIABLES,
  resolvePath,
  structureOf,
  validateTemplate,
} from '../../../shared/macros';
import { VariableHoverCard } from './studio/VariableHoverCard';
```

Add beside the other memos (below `const warnings = …` from Task 7):

```tsx
  const structureRoot = useMemo(() => structureOf(buildSampleContext()), []);
```

Replace the quick-chip block (the `{QUICK_VARS.map(…)}` body added at lines 183-194) with:

```tsx
            {QUICK_VARS.map((v) => {
              const meta = MACRO_VARIABLES.find((x) => x.name === v);
              const resolved = resolvePath(structureRoot, [v]);
              const chip = (
                <button
                  key={v}
                  type="button"
                  onClick={() => st.insertVar(v)}
                  className="rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1 font-mono text-[11px] text-cs-accent hover:bg-cs-bg-3"
                >
                  {v}
                </button>
              );
              if (!meta) return chip;
              return (
                <HoverCard key={v} openDelay={150} closeDelay={100}>
                  <HoverCardTrigger asChild>{chip}</HoverCardTrigger>
                  <HoverCardContent side="top" align="start" sideOffset={8} collisionPadding={8} className="w-auto max-w-80 p-3">
                    <VariableHoverCard variable={meta} structure={resolved.ok ? resolved.node : null} />
                  </HoverCardContent>
                </HoverCard>
              );
            })}
```

`side="top"` here, not `"left"` — the chips sit at the bottom of the editor column, so the card opens upward into free space rather than over the template.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run --project dom tests/component/macros && npx tsc --noEmit && npx biome check src tests`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/panels/macros/studio/VariableHoverCard.tsx src/renderer/panels/macros/studio/FilterHoverCard.tsx src/renderer/panels/macros/studio/ReferencePanel.tsx src/renderer/panels/macros/MacroStudio.tsx tests/component/macros/VariableHoverCard.test.tsx tests/component/macros/MacroReferenceRail.test.tsx tests/component/macros/MacroStudio.test.tsx
git commit -m "$(cat <<'EOF'
feat(macros): hover cards on reference variable and filter rows

Surfaces the untruncated description, the nested field names derived from the
sample, and the example/signature the manifest has always carried but nothing
rendered. Card bodies are prop-driven so they can be tested without simulating
a Radix hover.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Context tab

**Files:**
- Create: `src/renderer/panels/macros/studio/ContextTree.tsx`
- Modify: `src/renderer/panels/macros/studio/ReferencePanel.tsx:52`, `:126-142`, `:160-201`
- Test: `tests/component/macros/MacroReferenceRail.test.tsx`

**Interfaces:**
- Consumes: `structureOf`, `StructureNode`, `StructureField` (Task 4); `replyContext`/`sendContext`.
- Produces: `ContextTree({ node, onInsertPath }: { node: StructureNode; onInsertPath: (path: string) => void })`.

- [ ] **Step 1: Write the failing test**

Append to `tests/component/macros/MacroReferenceRail.test.tsx`:

```ts
  it('shows a Context tab listing sample fields with type and value', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText: vi.fn() } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    // Query by row, not by text: my_name and my_callsign share the value
    // "N0CALL", so getByText would match two elements and throw.
    const row = screen.getByTestId('ctx-row-my_name');
    expect(row.textContent).toContain('my_name');
    expect(row.textContent).toContain('N0CALL');
    expect(row.textContent).toContain('string');
  });

  it('expands a nested object and inserts the dotted path', () => {
    const insertText = vi.fn();
    useStore.setState({ macroStudioBridge: { previewMode: 'reply', insertVar: vi.fn(), insertText } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    fireEvent.click(screen.getByRole('button', { name: /expand my_pos/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert my_pos.lat' }));
    expect(insertText).toHaveBeenCalledWith('{{ my_pos.lat }}');
  });

  it('reflects the send-mode context, where reply-only variables are null', () => {
    useStore.setState({ macroStudioBridge: { previewMode: 'send', insertVar: vi.fn(), insertText: vi.fn() } });
    render(<MacroReferenceRail />);
    fireEvent.click(screen.getByRole('tab', { name: /context/i }));
    const row = screen.getByTestId('ctx-row-sender_name');
    expect(row.textContent).toContain('null');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/macros/MacroReferenceRail.test.tsx`
Expected: FAIL — no Context tab.

- [ ] **Step 3: Create `ContextTree.tsx`**

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { StructureField, StructureNode } from '../../../../shared/macros/structure';

function typeLabel(node: StructureNode): string {
  if (node.kind === 'array') return `array[${node.length}]`;
  if (node.kind === 'object') return 'object';
  return node.nullable ? `${node.type}|null` : node.type;
}

function isExpandable(node: StructureNode): boolean {
  if (node.kind === 'object') return node.fields.length > 0;
  return node.kind === 'array' && node.element !== null;
}

/** The fields shown when a node is expanded. An array shows its element's
 *  fields — the shape a `map:` or a `.first.` reaches. */
function childrenOf(node: StructureNode): StructureField[] {
  if (node.kind === 'object') return node.fields;
  if (node.kind === 'array' && node.element?.kind === 'object') return node.element.fields;
  return [];
}

/** Liquid path for an array's inner field: `paths` → `paths.first.hops`. */
function childPath(parentPath: string, node: StructureNode, name: string): string {
  return node.kind === 'array' ? `${parentPath}.first.${name}` : `${parentPath}.${name}`;
}

function Row({ field, path, depth, onInsertPath }: { field: StructureField; path: string; depth: number; onInsertPath: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const expandable = isExpandable(field.node);
  return (
    <>
      <div className="flex items-center gap-1 px-3 py-0.5" data-testid={`ctx-row-${field.name}`} style={{ paddingLeft: 12 + depth * 12 }}>
        {expandable ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${field.name}`}
            onClick={() => setOpen(!open)}
            className="shrink-0 text-cs-text-dim hover:text-cs-text"
          >
            {open ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}
          </button>
        ) : (
          <span className="size-3 shrink-0" />
        )}
        <button
          type="button"
          aria-label={`Insert ${path}`}
          onClick={() => onInsertPath(`{{ ${path} }}`)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:bg-cs-bg-3"
        >
          <span className="font-mono text-[11px] text-cs-accent">{field.name}</span>
          <span className="shrink-0 rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-text-muted">
            {typeLabel(field.node)}
          </span>
          {field.sample !== undefined && (
            <span className="truncate font-mono text-[11px] text-cs-text-muted">{field.sample}</span>
          )}
        </button>
      </div>
      {open &&
        childrenOf(field.node).map((child) => (
          <Row
            key={child.name}
            field={child}
            path={childPath(path, field.node, child.name)}
            depth={depth + 1}
            onInsertPath={onInsertPath}
          />
        ))}
    </>
  );
}

/** Browsable view of the sample context: field, sample type, sample value. */
export function ContextTree({ node, onInsertPath }: { node: StructureNode; onInsertPath: (path: string) => void }) {
  if (node.kind !== 'object') return null;
  return (
    <div className="py-1">
      {node.fields.map((f) => (
        <Row key={f.name} field={f} path={f.name} depth={0} onInsertPath={onInsertPath} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add the tab to `ReferencePanel`**

Add imports:

```tsx
import { replyContext, sendContext } from '../lib/sampleContext';
import { ContextTree } from './ContextTree';
```

Replace line 52:

```tsx
type Tab = 'vars' | 'filters';
```

with:

```tsx
type Tab = 'vars' | 'filters' | 'context';
```

Add below the `structureRoot` memo from Task 9:

```tsx
  // Unlike the lint, the tab follows the preview toggle — its job is to show
  // what the author will actually get in each mode.
  const contextRoot = useMemo(() => structureOf(mode === 'reply' ? replyContext() : sendContext()), [mode]);
```

In the tablist (lines 127-141), replace the tab array and label with:

```tsx
            {(['vars', 'filters', 'context'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  tab === t ? 'bg-cs-bg-3 text-cs-text' : 'text-cs-text-muted hover:text-cs-text',
                )}
              >
                {t === 'vars' ? 'Variables' : t === 'filters' ? 'Filters' : 'Context'}
              </button>
            ))}
```

Hide the search box on the Context tab — replace the `<div className="relative mt-2">` block's opening (line 144) with:

```tsx
        {tab !== 'context' && (
          <div className="relative mt-2">
```

and close it after the `</div>` that ends that block (line 157) with:

```tsx
          </div>
        )}
```

Finally, in the body (line 161), change the two-branch ternary into three. Replace:

```tsx
        {tab === 'vars' ? (
```

with:

```tsx
        {tab === 'context' ? (
          <ContextTree node={contextRoot} onInsertPath={onInsertFilter} />
        ) : tab === 'vars' ? (
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run --project dom tests/component/macros`
Expected: PASS.

- [ ] **Step 6: Full verification**

Run: `npx vitest run`
Expected: PASS — whole suite.

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npx biome check src tests`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/panels/macros/studio/ContextTree.tsx src/renderer/panels/macros/studio/ReferencePanel.tsx tests/component/macros/MacroReferenceRail.test.tsx
git commit -m "$(cat <<'EOF'
feat(macros): browsable Context tab in the reference rail

Third tab beside Variables and Filters showing each field's name, sample type
and sample value, expandable into nested objects and array elements, with
click-to-insert. Follows the preview mode so send-mode nulls are visible.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification

After Task 10, the original report should be reproducible end to end:

1. Open the Macros tool, edit the `Path` macro.
2. Set the template to `{{ paths.first.hops | map: "pubkey" }}` — the preview shows an amber warning naming `pubkey` and suggesting `pk`, and Save stays enabled.
3. Change it to `{{ paths.first.hops | map: "short_id" | join: " → " | default: "direct" }}` — the warning clears.
4. Hover `paths` in the Reference — the card lists `id`, `length`, `hash_mode`, `final_snr`, `hops`, `all_hops`.
5. Open the Context tab, expand `paths` → `hops` — `short_id`, `name` (`string|null`), `pk` (`string|null`) with their sample values.
6. Confirm the studio is one column, preview beneath the editor.
