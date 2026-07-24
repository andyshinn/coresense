# Macro Structure Inspection — Debugging What a Variable Actually Contains — Design

- **Date:** 2026-07-23
- **Branch/worktree:** `feat/custom-macros` (`.claude/worktrees/feat+custom-macros`)
- **Status:** Approved shape, pending spec review
- **Builds on:** [2026-06-21-custom-macros-design.md](2026-06-21-custom-macros-design.md) (the Studio, Reference rail, and preview surfaces this change extends)

## Summary

A macro author wrote `{{ paths.first.hops | map: "pk" | join: "," }}` and got `","`
back. No error, no hint. Reaching for `{{ paths.first.hops }}` to find the right field
name produced `[object Object][object Object]`. Switching to the documented `short_id`
then produced `eg,eg` on a direct message — two lowercased name-slices, no relay hops,
and no way to say "direct".

This change does two things. It **fixes the path shape** so `paths[].hops` means the
relays between the sender and us, with resolved names and pubkeys, and `length` means the
relay count. And it makes context structure **visible** in three places sharing one
derivation: hover cards on Reference rail rows, a Context tab beside Variables and
Filters, and a non-blocking unknown-property warning in the Studio preview.

Every liquidjs behaviour claim below was executed against this worktree's
`node_modules/liquidjs` (10.27) using the exact options from
[`engine.ts:17-24`](../../../src/shared/macros/engine.ts#L17-L24).

## The failures, precisely

### A. `map: "pk"` renders `","`

**No `pk` field exists.** `MacroPathHop` is `{kind, short_id, name}`
([`types.ts:8-16`](../../../src/shared/macros/types.ts#L8-L16)) and
[`contextBuilder.ts:30`](../../../src/main/macros/contextBuilder.ts#L30) builds exactly
those three keys. The field name was a guess, made because nothing in the UI shows the
shape.

**`map` silently swallows the typo.** liquidjs's `map` calls
`_getFromScope(item, stringify(property), false)` with `strictVariables` hard-coded
`false` (`node_modules/liquidjs/dist/liquid.node.mjs:3372`), so a missing key yields
`undefined` instead of throwing:

| Expression | Result |
| --- | --- |
| `{{ paths.first.hops.first.pk }}` | throws `UndefinedVariableError: undefined variable: paths.first.hops.first.pk` |
| `{{ paths.first.hops \| map: "pk" \| join: "," }}` | renders `","` — no error |

`map`, `sort`, `sort_natural` and `sum` are the only property-taking built-ins that opt
out of strict mode; `where`, `reject`, `has`, `find`, `find_index`, `group_by`,
`where_exp` and `find_exp` all throw correctly. The silent failure is confined to a known,
enumerable set of four filters.

### B. `map: "short_id"` renders `eg,eg` on a direct message

The paths in `meta.paths` come from meshcore-ts's `buildPath`
(`node_modules/@andyshinn/meshcore-ts/dist/index.js:1907-1932`, source `src/model/paths.ts`):

```js
hops.push({ kind:"origin", shortId: senderName ? senderName.slice(0,2).toLowerCase() : "??", name: senderName ?? null, … })
for (let i=0; i<pathHex.length; i+=hashSize*2)
  hops.push({ kind:"hop", shortId: pathHex.slice(i, i+hashSize*2), name: null, pk: null, unnamed: true })
hops.push({ kind:"sink", shortId: ownerName ? ownerName.slice(0,2).toLowerCase() : "me", name: ownerName ?? "My radio", … })
```

Three consequences, all verified by replicating `buildPath` exactly:

1. **A direct path has zero `kind:'hop'` entries** — `pathHex` is empty, so `hops` is just
   `[origin, sink]`. Mapping all of them yields the two endpoint labels.
2. **`short_id` means two unrelated things.** For a relay it is real wire hex. For
   origin/sink it is `name.slice(0,2).toLowerCase()` — a display label. An owner named
   `egrme.sh Hand` gives `eg`, which is where both halves of `eg,eg` come from.
3. **`length` is already wrong.** [`contextBuilder.ts:27`](../../../src/main/macros/contextBuilder.ts#L27)
   sets `length: p.hops.length`, which counts the endpoints — a direct path reports
   `length: 2` and a 3-relay path reports `5`. Verified: `{% if paths.first.length == 0 %}`
   renders `relayed` for a direct message, so the obvious "show direct when the path is
   empty" idiom cannot work today.

### C. `map: "name"` renders all-empties

meshcore-ts sets `name: null, unnamed: true` on **every** relay hop; names are resolved
only in the renderer at paint time, by a four-line pubkey-prefix match
([`resolveRepeater.ts:20-24`](../../../src/renderer/components/path/resolveRepeater.ts#L20-L24))
used by [`HopRow.tsx:29-33`](../../../src/renderer/components/path/HopRow.tsx#L29-L33).
The macro context copies `h.name ?? null` without resolving, so `map: "name"` is always
empty for relays — while `ReferencePanel.tsx:18` advertises `map: "name"` as the insert
stub for `map`. Same silent-empty family as (A).

### D. Bare objects stringify to `[object Object]`

`Emitter.write` → `stringify` → `String(value)` (`liquid.node.mjs:71-80`); no
`outputEscape` is configured. The escape hatch — `{{ x | json }}` — **already works
today** but appears in none of the app's three filter doc lists, so it is undiscoverable.

## Goals

- `paths[].hops` means **the relays between the sender and us**, with names and pubkeys
  resolved; `paths[].length` is the relay count, `0` on a direct path.
- A direct message renders as `direct` without needing a `{% %}` tag.
- Every variable and filter row in the Reference rail explains itself on hover, including
  the nested field names of object and array variables.
- A Context tab lets an author browse the whole sample context — field, type, and sample
  value — and insert a path with one click.
- A template naming a property that does not exist produces a **warning with a
  suggestion** in the Studio preview, without blocking save.
- `{{ x | json }}` becomes discoverable and stops lying about absent values.
- The Studio is one column — preview under the editor — instead of two.

## Non-goals

- **Changing meshcore-ts.** `buildPath`'s origin→sink timeline is correct for its
  consumer: `PathViewer`/`HeardVia` draw the full journey. The abbreviation is coresense's
  own projection and belongs in `mapPaths`. Worth flagging upstream separately (not
  blocking): `MessageHop.shortId` carrying both wire hex and a lowercased name slice
  depending on `kind` is a type-level lie.
- **Per-token hover inside the editor.** The painted `<pre>` is `aria-hidden` and
  `pointer-events-none` with the transparent `<textarea>` layered above it
  ([`MacroEditor.tsx:89-91,155`](../../../src/renderer/panels/macros/studio/MacroEditor.tsx#L89-L91)),
  so every pointer event lands on the textarea. Supporting hover there needs token
  identity plus offsets in `TokenRun` (today `{text,type}`,
  [`tokenize.ts:18-21`](../../../src/renderer/panels/macros/lib/tokenize.ts#L18-L21)) and
  a mouse-XY → character-offset hit test that does not exist, and risks caret placement
  and drag-select regressions. Deferred deliberately.
- **Changing Liquid runtime semantics.** `map` stays lenient. Overriding it would make
  previously-saved macros fail `assertValid`
  ([`store.ts:15-18`](../../../src/main/macros/store.ts#L15-L18)) on next edit. The lint
  catches the same class of mistake at authoring time instead.

  One exception, called out honestly: `PlaceholderDrop.toJSON()` (§4) changes what
  `{{ x | json }}` emits for an absent value from `{"text":"?"}` to `"?"` on the shared
  `renderTemplate` path, so a saved macro piping a null variable through `json`/`inspect`
  will send different text. Intended and small, but it is a runtime change.
- **`{% %}` support in the tokenizer.** Check (b) of the lint walks `{{ }}` output nodes
  only — the same boundary the tokenizer already draws (`scan()` only recognises `{{`,
  [`tokenize.ts:169-190`](../../../src/renderer/panels/macros/lib/tokenize.ts#L169-L190)).
  Check (a) is whole-template by construction and that is intentional:
  `globalVariableSegmentsSync` reports `paths.first.hops` from
  `{% for h in paths.first.hops %}` even with no `{{ }}` in the template, and a bad path
  there deserves the same warning. §1's `default:` idiom exists precisely so the common
  "show direct" case needs no tag.
- Showing the *real* runtime context of a specific message in the Studio. That is built in
  main and never crosses the boundary; `POST /api/macros/render` returns only the rendered
  string ([`routes.ts:956`](../../../src/main/api/routes.ts#L956)). All *inspection* is of
  the sample context.

## Decisions

| Decision | Choice |
| --- | --- |
| Path abbreviation | `hops` = relays only; `all_hops` = full origin→sink timeline |
| `length` | Relay count — `0` on a direct path |
| Hop name / pk | Resolved in `mapPaths` from contacts, **only on an unambiguous prefix match** |
| "direct" idiom | `\| default: "direct"` — filter-only, no `{% if %}` |
| Structure source | **Derived at runtime** from `buildSampleContext()`, not authored on `MacroVariable` |
| Lint delivery | **Separate `lintTemplate`**, not folded into `validateTemplate` |
| Lint severity | **Warning** — never blocks save |
| Lint scope | Variable paths anywhere in the template; filter key-args in `{{ }}` output nodes only |
| Lint context | Always `buildSampleContext()`, taken internally — never the current preview mode |
| Suggestions | Alias table first, bounded Levenshtein as fallback |
| Studio layout | One column — preview stacked under the editor, not in the rail |
| Inspector home | **Third tab in the Reference rail**, not the Preview pane |
| Inspector contents | Field name, **sample** type, and sample value |
| Debug filter | Document the existing `json`/`inspect`; add no new filter |
| Placeholder JSON | Add `toJSON()` to `PlaceholderDrop` |
| Hover card bodies | Standalone components — body extracted like `OwnerCardPopover`, but props-in rather than store-in |

### Why derive rather than author

An explicit `fields?: {name, type, nullable}[]` on `MacroVariable` would be more
expressive, and would also be a third hand-maintained list that must track `types.ts` and
`contextBuilder.ts`. The repo already demonstrates this failure mode: filter *registration*
([`filters.ts:48,54,60`](../../../src/shared/macros/filters.ts#L48)) and filter *docs*
([`manifest.ts:87-106`](../../../src/shared/macros/manifest.ts#L87-L106)) are maintained in
parallel with nothing enforcing agreement, which is exactly why `json` and `inspect` work
but are documented nowhere.

Deriving from `buildSampleContext()` cannot drift, because it is the same object the
preview renders against. The cost is honesty about types: nullability is recovered only
where the sample varies, and never for top-level variables (§2).

### Why the lint is separate from validation

`validateTemplate` feeds two consumers that must keep their current meaning: `canSave`
([`MacroStudio.tsx:45`](../../../src/renderer/panels/macros/MacroStudio.tsx#L45)) and
`assertValid` ([`store.ts:15-18`](../../../src/main/macros/store.ts#L15-L18)), thrown on
add/update and surfaced as HTTP 400
([`routes.ts:923,944`](../../../src/main/api/routes.ts#L923)). Adding property warnings to
`ValidateResult.errors` would make a macro with a suspect property name **unsaveable**. A
separate `lintTemplate` called only from the Studio keeps blocking validation as it is.

## 1. Path shape

The data-model change everything else derives from, so it lands first.

### Types — `src/shared/macros/types.ts`

```ts
export interface MacroPathHop {
  /** In `hops` this is always 'hop'. `all_hops` also carries 'origin' and 'sink'. */
  kind: 'origin' | 'hop' | 'sink';
  /** Relay hops: the per-hop key prefix as encoded on the wire (1–3 bytes hex,
   *  per the path's hash_mode). Origin/sink in `all_hops`: a lowercased 2-char
   *  slice of the node name — a display label, NOT wire data. */
  short_id: string;
  /** The matching repeater's name, resolved locally from short_id. Null when no
   *  contact matches or when more than one does. Origin/sink carry the sender /
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

The existing four-line comment at `types.ts:10-13` ("no `pk` field is exposed here")
is replaced — it documented the old contract.

### Builder — `src/main/macros/contextBuilder.ts:23-32`

```ts
function resolveHop(shortId: string, repeaters: Contact[]): { name: string | null; pk: string | null } {
  if (shortId.length === 0) return { name: null, pk: null };   // empty prefix matches everything
  const prefix = shortId.toLowerCase();
  const matches = repeaters.filter((c) => c.publicKeyHex.toLowerCase().startsWith(prefix));
  if (matches.length !== 1) return { name: null, pk: null };   // unknown OR ambiguous
  return { name: matches[0].name, pk: matches[0].publicKeyHex };
}

function mapPaths(paths: MessagePath[] | undefined, repeaters: Contact[]): MacroPath[] {
  if (!paths) return [];
  return paths.map((p) => {
    const all = p.hops.map((h) =>
      h.kind === 'hop'
        ? { kind: h.kind, short_id: h.shortId, ...resolveHop(h.shortId, repeaters) }
        : { kind: h.kind, short_id: h.shortId, name: h.name ?? null, pk: null },
    );
    const relays = all.filter((h) => h.kind === 'hop');
    return { id: p.id, length: relays.length, hash_mode: p.hashMode, final_snr: p.finalSnr, hops: relays, all_hops: all };
  });
}
```

**`resolveHop` takes repeaters, not all contacts.** This is load-bearing, not incidental:
`candidatesFor`
([`resolveRepeater.ts:20-24`](../../../src/renderer/components/path/resolveRepeater.ts#L20-L24))
is only ever called with a pre-filtered list —
[`rightrail/index.tsx:44`](../../../src/renderer/shell/rightrail/index.tsx#L44) does
`contacts.filter((c) => c.kind === 'repeater')` before it reaches `HopRow`. Passing
`holder.getContacts()` (which returns every `'chat' | 'repeater' | 'sensor' | 'room'`,
[`types.ts:91`](../../../src/shared/types.ts#L91)) would break in two directions: a chat
contact sharing a prefix creates false ambiguity so the macro emits `null` exactly where
the Path viewer confidently shows a repeater name, and a prefix matched *only* by a
non-repeater would name someone's phone as a mesh relay in a transmitted message — the
precise outcome the one-match rule exists to prevent.

The empty-prefix guard mirrors `resolveRepeater.ts:21`. `startsWith('')` matches every
contact, so without it a single-entry address book resolves an empty-`short_id` hop to that
entry. `buildPath` never emits an empty `shortId` for a relay today, but `MessageHop.shortId`
is a plain `string` ([`types.ts:158-164`](../../../src/shared/types.ts#L158-L164)).

**Ambiguity is the common case, not an edge case.** At `hash_mode: 1` a prefix is two hex
chars — 256 values — so collisions are expected, and `HopRow` already treats multiple
candidates as a conflict rather than picking one.

`buildReplyContext` gains a `repeaters: Contact[]` argument, supplied at
[`routes.ts:986`](../../../src/main/api/routes.ts#L986) from
`holder.getContacts().filter((c) => c.kind === 'repeater')`. The existing
`holder.getContacts()` call at
[`:984`](../../../src/main/api/routes.ts#L984) is inside a conditional expression, so this
needs its own call or a hoisted local. `buildSendContext` does not need it: it sets
`paths: []`.

### The "direct" idiom

No `{% if %}` required, which keeps macros inside the tokenizer's grammar. Verified
against a byte-exact replica of `buildPath`:

| Template | Direct | 3 relays |
| --- | --- | --- |
| `{{ paths.first.hops \| map: "short_id" \| join: " → " \| default: "direct" }}` | `direct` | `a1 → 37 → a8` |
| `{{ paths.first.length }}` | `0` | `3` |

`default` treats the empty string as falsy (verified: `{{ "" | default: "X" }}` → `X`), so
an empty relay list collapses to the fallback with no conditional.

**Indexing an empty `hops` throws, though.** Under `strictVariables: true`, a direct path
turns `.first`/`.last`/`[0]` into a hard render error rather than an empty string —
verified:

| Template | Before §1 (direct path) | After §1 (direct path) |
| --- | --- | --- |
| `{{ paths.first.hops.first.name }}` | `Alice` | **throws** `undefined variable: paths.first.hops.first` |
| `{{ paths.first.hops \| size }}` | `2` | `0` |

`wrapScope` is top-level only, so this is not softened to a placeholder. Pipeline idioms
(`map`/`join`/`where`/`size`/`default`) are safe on an empty list; direct indexing is not,
and the manifest example uses the pipeline form for that reason. Nothing shipped is at
risk — `src/shared/macros` does not exist on `main` (`git log main -- src/shared/macros` is
empty), so there are no saved user macros predating this change.

### Manifest

The `paths` entry ([`manifest.ts:78-84`](../../../src/shared/macros/manifest.ts#L78-L84))
gets a description covering the `hops`/`all_hops` split and this example:

```
{{ paths.first.hops | map: "short_id" | join: " → " | default: "direct" }}
```

### Sample context

`buildSampleContext()`'s path ([`manifest.ts:139-150`](../../../src/shared/macros/manifest.ts#L139-L150))
must carry **relay hops**, or `hops` derives as an empty array with `element: null` and
every downstream feature — hover structure, Context tab, lint — has nothing to show. It
also needs a hop with `name: null`, both to exercise the ambiguous/unknown branch and to
give §2 the nullability it otherwise cannot derive:

```ts
paths: [{
  id: 'p1', length: 2, hash_mode: 1, final_snr: 6.5,
  hops: [
    { kind: 'hop', short_id: 'a1', name: 'Tarrytown East Solar', pk: 'a137f2…' },
    { kind: 'hop', short_id: '37', name: null, pk: null },
  ],
  all_hops: [
    { kind: 'origin', short_id: 'al', name: 'Alice', pk: null },
    { kind: 'hop', short_id: 'a1', name: 'Tarrytown East Solar', pk: 'a137f2…' },
    { kind: 'hop', short_id: '37', name: null, pk: null },
    { kind: 'sink', short_id: 'me', name: 'Me', pk: null },
  ],
}]
```

`sampleContext.ts`'s hand-written `WORST_CASE_PATH`
([`sampleContext.ts:20-32`](../../../src/renderer/panels/macros/lib/sampleContext.ts#L20-L32))
is a second literal of `MacroPath` and must be updated to the same shape.

## 2. `src/shared/macros/structure.ts` (new)

Pure, no React, no engine dependency.

```ts
export type StructureNode =
  | { kind: 'scalar'; type: 'string' | 'number' | 'boolean' | 'null' | 'unknown' }
  | { kind: 'object'; fields: StructureField[] }
  | { kind: 'array'; length: number; element: StructureNode | null };

export interface StructureField {
  name: string;
  node: StructureNode;
  /** Present when the sample carries a displayable value. */
  sample?: string;
}

/** Mirrors liquidjs's SegmentArray (analysis.d.ts:13): index segments arrive as
 *  numbers, dynamic subscripts (`a[b.c]`) as nested arrays. */
export type PathSegment = string | number | PathSegment[];

export function structureOf(value: unknown): StructureNode;

/** Resolves a variable path. Returns the node reached, the index of the first
 *  segment that failed, or `dynamic` when a nested-array segment aborts
 *  resolution (dynamic paths are skipped, not guessed at). */
export function resolvePath(
  root: StructureNode,
  path: PathSegment[],
):
  | { ok: true; node: StructureNode }
  | { ok: false; failedAt: number }
  | { ok: false; dynamic: true };

/** Convenience wrapper: field names reachable at a path, or null. */
export function fieldsAt(root: StructureNode, path: PathSegment[]): string[] | null;
```

`string[]` would be insufficient in three ways: index segments arrive as `number`s,
dynamic segments as nested arrays, and §3's two checks need the *failing segment index*
(check a) and the *resolved node* (check b) respectively. Verified:
`globalVariableSegmentsSync('{{ paths[0].hops[1].short_id }}')` →
`[["paths",0,"hops",1,"short_id"]]`; `'{{ a[b.c] }}'` → `[["a",["b","c"]],["b","c"]]`.

Behaviour:

- **Array element shapes merge across all items.** Merging unions the observed types per
  key, so a field seen as both `string` and `null` reports `string | null`, and a key
  present on only some elements is still listed.

  **This recovers nullability only where the sample actually varies** — which is why §1's
  sample carries one named and one unnamed relay hop, making `name` and `pk` derive as
  `string | null` rather than `string`. At the top level it cannot be recovered at all: 24
  of the 25 `MacroContext` fields are `| null`
  ([`types.ts:28-54`](../../../src/shared/macros/types.ts#L28-L54)), but
  `tests/unit/macros/manifest.test.ts:22-28` asserts `buildSampleContext()` has no
  top-level nulls. The type column therefore reports *what the sample contains*, and the
  Context tab labels it **"sample type"**, not declared type.
- **Path resolution steps through arrays and pseudo-properties.**
  `fieldsAt(root, ['paths','first','hops'])` descends `array → element` for `first` and
  `last`, steps through a numeric index segment, and resolves `size` to
  `{kind:'scalar', type:'number'}` on arrays, strings **and** plain objects. `size` is not
  optional: it is advertised by the app's own `STANDARD_FILTERS`
  ([`ReferencePanel.tsx:41`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L41)),
  and without it `{{ paths.size }}` warns on a correct macro. Verified: `{{ paths.size }}`
  → `1`, `{{ message_body.size }}` → `11`, `{{ paths.first.size }}` → `5` (object key
  count), `{{ paths.first.hops.size }}` → `2`. `first`/`last` are array-only; `size` also
  applies to strings and objects.
- **`PlaceholderDrop` maps to `unknown`** via `isPlaceholder`
  ([`placeholder.ts:19-21`](../../../src/shared/macros/placeholder.ts#L19-L21)). A
  defensive branch, not a live path: placeholders exist only inside `wrapScope` at render
  time, and §3 and §6 both pass a raw `MacroContext`.
- Non-JSON values (`Date`, `Map`, `RegExp`, functions, `BigInt`) do not occur in
  `MacroContext` today, but `structureOf` degrades them to `unknown` rather than throwing.

## 3. `src/shared/macros/lint.ts` (new)

```ts
export interface MacroWarning {
  kind: 'unknown-property';
  message: string;
  /** The offending path or key, e.g. 'paths.first.hops.pk' or 'pk'. */
  name: string;
  suggestion?: string;
  line?: number;
  col?: number;
}

export function lintTemplate(template: string): MacroWarning[];
```

The signature deliberately mirrors `validateTemplate(template: string)`
([`validate.ts:13`](../../../src/shared/macros/validate.ts#L13)), including the lazy
module-level cached engine (`validate.ts:7-11`). Taking no context argument makes the
"always the reply sample" rule **structural** rather than a convention a caller could
break:

- `sendContext()` sets `paths: []`
  ([`sampleContext.ts:16`](../../../src/renderer/panels/macros/lib/sampleContext.ts#L16)),
  whose structure is `{kind:'array', length:0, element:null}`. Linting against it would
  flag `paths.first.hops` — the manifest's own flagship example — the moment the author
  toggled the preview.
- The preview toggle is a preview control, not a declaration of the macro's mode:
  `MacroTemplate` ([`types.ts:59-68`](../../../src/shared/macros/types.ts#L59-L68)) has no
  mode field.

**`lintTemplate` must be total.** It runs on every keystroke, the same shape as the
`validateTemplate` memo at
[`MacroStudio.tsx:44`](../../../src/renderer/panels/macros/MacroStudio.tsx#L44). Both APIs
it uses throw on a partially-typed template — verified: `'{{ paths.'` throws
`output "{{ paths." not closed` and `'{{ paths | nope }}'` throws `undefined filter: nope`
from *both* `parse` and the analysis call. Wrap both in try/catch and return `[]`; parse
failures are `validateTemplate`'s job. `validate.ts:16-20` already guards the same way.

Two checks, both resolved against `structureOf(buildSampleContext())`.

**Whenever resolution reaches an array whose `element` is `null`, both checks skip rather
than warn** — an empty sample is not evidence the property is wrong. This rule carries
more weight after §1, because a direct path legitimately has `hops: []`.

**(a) Variable paths.** `engine.globalVariableSegmentsSync(template)` returns
`[["paths","first","hops"]]` for the failing macro. The `global*` variant is **mandatory**:
plain `variableSegmentsSync` returns template-local names alongside globals — verified,
`{% for h in paths.first.hops %}{{ h.short_id }}{{ forloop.index }}{% endfor %}` yields
`[["paths","first","hops"],["h","short_id"],["forloop","index"]]` from the plain call but
only `[["paths","first","hops"]]` from the global one — so it would false-positive on every
`{% assign %}` local, `{% for %}` loop variable, `{% capture %}` name, and on `forloop`.

Neither variant carries source locations, so `line`/`col` cannot be filled from this call.
Either omit them for check (a) or take them from
`parseAndAnalyzeSync(template).globals[name].location {row, col}`.

**(b) Filter key-args.** The analysis API does not see filter string arguments, so this
walks the parse tree directly. Verified shape:

```
engine.parse('{{ paths.first.hops | map: "pk" | join: "," }}')[0].value.filters
  → [ { name: 'map',  args: [QuotedToken '"pk"'  @27-31] },
      { name: 'join', args: [QuotedToken '","'   @40-43] } ]
```

`QuotedToken` carries `begin`/`end` offsets relative to the whole template, which convert
to line/col.

For each filter in `PROPERTY_FILTERS` (`map`, `where`, `sort`, `sort_natural`, `group_by`,
`sum`), resolve the piped-in expression's structure **through the preceding filter chain**,
take its `element` shape, and check the quoted key against it.

Resolving the head variable alone is wrong for any filter after the first —
`{{ paths | map: "hops" | first | map: "short_id" | join: "," }}` renders correctly, but
the second `map` checked against `MacroPath`'s keys would false-positive, and
`{{ paths.first.hops | group_by: "kind" | map: "items" | size }}` renders `2` though
`items` is not on `MacroPathHop`. Model only the transforms this design needs — `map` →
element becomes that field's node; `group_by` → `[{name, items}]`; `first`/`last` →
unwrap; `where`/`reject`/`sort`/`sort_natural` → preserve — and **abandon check (b) for
the rest of the chain** the moment an unmodelled filter appears.

Per-filter argument rules, which are not uniform:

- `sort`, `sort_natural` and `sum` take the key **optionally**
  (`liquid.node.mjs:3355-3362, 3376-3383`) — `{{ nums | sort }}` and `{{ hops | sum }}`
  are correct and must not warn.
- `sortBy` uses `stringify(property).split('.')` (`:3360`), so `sort: "meta.snr"` is a
  nested lookup, while `map`/`sum` do not split (`:3372, 3381`) so `map: "meta.snr"` is a
  literal key.
- `where`, `group_by`, `reject`, `find` and `has` **throw** under `strictVariables`, so a
  bad key there already produces a red blocking `ValidateResult` error
  ([`PreviewPane.tsx:121-128`](../../../src/renderer/panels/macros/studio/PreviewPane.tsx#L121-L128)).
  When `validateTemplate` already reports an error for the same template, suppress the
  lint warning rather than showing both.

**Suggestions.** Edit distance alone cannot produce the headline answer — verified
`lev('pk','short_id') = 8` while `lev('pk','kind') = lev('pk','name') = 4`, so any usable
bound returns nothing and an unbounded nearest-match returns `kind`. The suggester is
therefore an **explicit alias table consulted first** (`pubkey`/`key`/`hash`/`prefix` →
`short_id`), falling back to bounded Levenshtein (≤2) over the available field names.

Note §1 makes `pk` itself a **real field**, so the original failing macro stops warning and
starts working. The alias table covers the neighbouring guesses, and the empty-output
suggestion below is what the remaining cases hit.

```
map: "pubkey" — hops[] has no "pubkey". Did you mean pk? (kind, short_id, name, pk)
```

**Known gaps**, documented in the module header: dynamic paths (`a[b.c]`) are skipped
rather than guessed at; filters inside `{% %}` tags are not walked; a key that exists on
only some array elements is accepted; an empty sample array disables checking below it.

## 4. `PlaceholderDrop.toJSON()`

`wrapScope` replaces top-level nulls with `PlaceholderDrop`
([`render.ts:6-11`](../../../src/shared/macros/render.ts#L6-L11)). `Drop` has no `toJSON`,
so `JSON.stringify` walks own enumerable fields and the constructor's parameter property
([`placeholder.ts:4`](../../../src/shared/macros/placeholder.ts#L4)) surfaces. `valueOf()`
is not consulted by the json filters. Verified using `sender_pos` in send mode (a
reply-only variable `sendContext()` actually nulls):

| | `{{ sender_pos \| json }}` | `{{ sender_pos }}` |
| --- | --- | --- |
| today | `{"text":"?"}` | `?` |
| with `toJSON()` | `"?"` | `?` |

One method. Without it, the debug filter this change advertises misreports every absent
value. Bare output, `liquidMethodMissing` property access, the `default` filter, and the
`isPlaceholder` passthroughs in
[`filters.ts:49-50,55-56,61`](../../../src/shared/macros/filters.ts#L49-L50) are all
unaffected — verified.

## 5. Documenting `json` / `inspect`

Both are registered built-ins under `strictFilters: true`, signature `(value, space = 0)`;
`{{ x | json: 2 }}` pretty-prints. `inspect` is identical except that it replaces circular
references with `"[Circular]"`.

Add both to `STANDARD_FILTERS` and `FILTER_INSERT`
([`ReferencePanel.tsx:11-42`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L11-L42)),
with `| json: 2` and `| inspect` as the insert stubs. `STANDARD_FILTERS` rather than
`MACRO_FILTERS`, because these are stock Liquid, not MeshCore filters — and adding to
`MACRO_FILTERS` would paint them teal as custom filters via
[`catalog.ts:11`](../../../src/renderer/panels/macros/lib/catalog.ts#L11).

While in `FILTER_INSERT`: `map`'s stub is `' | map: "name"'` (`:18`), which was reliably
empty before §1 and is merely sometimes-null after it. Change it to `' | map: "short_id"'`,
the field that is always populated.

No new filter is introduced. The Context tab covers "show me the shape"; `json` covers
"show me this expression's value mid-pipeline".

## 6. Context tab in the Reference rail

The rail gains a third tab: `Variables | Filters | Context`
([`ReferencePanel.tsx:52,126-142`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L126-L142)).

The rail rather than the Preview pane, because it is tall and narrow (right shape for a
tree), it already has a search box, it already receives `previewMode` over the studio
bridge, and the Preview pane already carries output, budget meter and validation in one
scroller.

Contents: the sample context for the current preview mode — `replyContext()` or
`sendContext()` — as an expandable tree of field, **sample type**, and sample value.
Objects and arrays collapse; scalars show their value. Clicking a row inserts its dotted
path through the bridge's existing `insertText`.

Unlike the lint, the tab **does** follow the preview toggle: its job is to show what the
author will actually get in each mode, and send mode is where it earns its keep — ten
variables are null there, and the tab shows plainly which.

Showing values as well as types is what makes this a debugging tool. Seeing
`short_id  string  "a1"` beside `name  string|null  "Tarrytown East Solar"` and a second
hop whose `name` is `null` answers "what is it called", "what does it look like", and "can
it be missing" at once.

## 7. Hover cards

**Surfaces:** variable rows
([`ReferencePanel.tsx:107-118`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L107-L118)),
MeshCore filter rows (`:176-188`), standard filter rows (`:190-199`), and the Studio
quick-var chips
([`MacroStudio.tsx:183-194`](../../../src/renderer/panels/macros/MacroStudio.tsx#L183-L194)).
All are real `<button>`s already.

**Two new components**, `VariableHoverCard.tsx` and `FilterHoverCard.tsx`, each a
prop-driven body with no store or context access. They follow
[`OwnerCardPopover.tsx`](../../../src/renderer/shell/leftnav/OwnerCardPopover.tsx) only in
*extracting the card body into its own component* — **not** in how it gets its data:
`OwnerCardPopover` takes no props and reads six values straight out of the Zustand store
(`OwnerCardPopover.tsx:91-101`), which is exactly the untestable shape §9 forbids.
Prop-driven is a testability requirement here, not a style preference.

**Variable card:** name, type badge, availability, the **full untruncated** description
(the row truncates it at `:115`), `example`, and — for object and array types — the
structure tree from §2.

**Filter card:** name, description, `signature`, and `example` **where present**. MeshCore
rows are `MacroFilterDoc` ([`types.ts:80-85`](../../../src/shared/macros/types.ts#L80-L85))
and carry all four; the seven standard rows are the module-local `FilterDoc`
([`ReferencePanel.tsx:24-28`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L24-L28))
with no `example` field, so the prop must be optional.

`MacroVariable.example` and `MacroFilterDoc.signature`/`example` are populated in the
manifest and **rendered nowhere in the app today**. Surfacing them is most of the value for
none of the work — the `paths` example is the exact incantation this whole change exists
because someone could not find.

**Trigger placement.** `InsertRow` serves all three row surfaces (`:110`, `:177`, `:191`)
and takes only `{label, onInsert, children}`
([`ReferencePanel.tsx:69`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L69)),
spreading nothing. So `<HoverCardTrigger asChild>` wrapped *around* `InsertRow` would
silently drop `onPointerEnter`/`onPointerLeave`/`onFocus`/`data-state` and the card would
never open — no warning, since React 19 treats `ref` as an ordinary prop.

Instead, `InsertRow` gains a `hoverCard?: React.ReactNode` prop; when present it wraps its
own `<button>` (`:71-82`) in
`<HoverCard><HoverCardTrigger asChild>…</HoverCardTrigger><HoverCardContent>{hoverCard}</HoverCardContent></HoverCard>`.

**Props**, matching the rail-adjacent consumer
([`ChannelPeople.tsx:61-73`](../../../src/renderer/shell/rightrail/sections/ChannelPeople.tsx#L61-L73)):
`openDelay={150} closeDelay={100}`, `side="left"`, `sideOffset={8}`, `collisionPadding={8}`
(the rail list is a scroller, `ReferencePanel.tsx:160`), and
`className="w-auto max-w-80 p-3"` to override the baked-in `w-64 p-4`
([`hover-card.tsx:27`](../../../src/renderer/components/ui/hover-card.tsx#L27)).
`OwnerCard` deliberately differs (`openDelay={200} closeDelay={120}`,
`align="start" side="right"`, no `collisionPadding`, `w-72`) and is not the model here;
`max-w-80` is a new value. `side` always points away from the rail, and delays must be set
explicitly or Radix's 700ms default applies.

**Typography:** section headings `font-mono text-[10px] uppercase tracking-wider`;
identifiers `font-mono text-[12px]`; values `font-mono text-[11px]`; descriptions
`text-[11px] text-cs-text-muted`; type badges
`rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-text-muted`.

The badge uses `text-cs-text-muted`, **not** the `text-cs-text-dim` the existing rows use:
this repo has already measured dim-on-bg-3 at 3.76:1 dark / 3.03:1 light, both under AA,
while muted clears it at 8.15 / 6.01
([`PathHashBadge.tsx:15-16`](../../../src/renderer/components/PathHashBadge.tsx#L15-L16)).
Token hues come from
[`tokenColors.ts:6-16`](../../../src/renderer/panels/macros/lib/tokenColors.ts#L6-L16).
`cs-error` is not a real token — the danger token is `cs-danger`.

**Accessibility:** `ChannelPeople`'s trigger is a `<span>` with no `tabIndex`, so Radix's
focus-open never fires there. (`OwnerCard`'s trigger `<div>` contains a real `<button>` and
Radix's `onFocus` bubbles, so that card *is* already keyboard-openable.) Because the
Reference triggers are real buttons, focus-open works for free and these cards become
keyboard-reachable. Tab-stepping the list will pop cards; that is the intended trade and is
why `openDelay` stays at 150ms rather than 0.

## 8. Preview pane

### Layout — one column, preview under the editor

The Studio is currently two columns
([`MacroStudio.tsx:102`](../../../src/renderer/panels/macros/MacroStudio.tsx#L102)):

```
grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.1fr_1fr]
  ├─ editor column   (…overflow-y-auto p-4 lg:border-r)
  └─ preview column  (min-h-0 → <PreviewPane/>)
```

It becomes one column with the preview stacked beneath the editor:

```
flex min-h-0 flex-1 flex-col
  ├─ editor   flex-1 min-h-0 overflow-y-auto p-4
  └─ preview  shrink-0 max-h-[45%] border-t border-cs-border → <PreviewPane/>
```

The editor takes the remaining height and scrolls; the preview is content-sized,
capped at 45% so a long render cannot squeeze the editor away, and scrolls internally past
that (`PreviewPane`'s body is already `min-h-0 flex-1 overflow-y-auto`,
[`PreviewPane.tsx:62`](../../../src/renderer/panels/macros/studio/PreviewPane.tsx#L62)).
`PreviewPane`'s root drops `h-full` ([`:35`](../../../src/renderer/panels/macros/studio/PreviewPane.tsx#L35)),
and the editor column's `lg:border-r` becomes the preview's `border-t`. Vertical order
inside the studio ends up: name/scope → template editor → quick-var chips → preview.

The right rail keeps the Reference (plus §6's Context tab) and is otherwise untouched.

**Why not put the preview in the rail.** It was considered and rejected on two counts,
both structural:

1. **It would break the lint wiring below.** `PreviewPane` is a child of `MacroStudio`,
   which is the only reason `validation` — and §8's new `warnings` — reach it as ordinary
   props. In the rail it is a sibling of the centre pane and can only be reached through
   `store.macroStudioBridge`
   ([`MacroReferenceRail.tsx:8`](../../../src/renderer/shell/rightrail/MacroReferenceRail.tsx#L8),
   published at `MacroStudio.tsx:39-42`). The bridge deliberately carries no template text:
   [`useStudio.ts:42-46`](../../../src/renderer/panels/macros/studio/useStudio.ts#L42-L46)
   routes `value` through a ref precisely "so the insert callbacks stay stable — the
   right-rail Reference … shouldn't re-register on every keystroke". Preview in the rail
   means pushing `value` (or the whole render result) into the store on every keystroke,
   reversing that decision.
2. **Collapsing the rail would delete the feedback.**
   [`AppShell.tsx:67`](../../../src/renderer/shell/AppShell.tsx#L67) is
   `{rightOpen && <RightRail client={client} />}` — ⌘. *unmounts* the rail. The preview,
   character budget and validation state would vanish mid-edit with nothing left in the
   studio showing whether the macro renders, which would have needed either a
   pin-rail-open special case or a second compact preview surface.

Stacking needs neither. It also gives the editor the full centre width, which suits
templates that run past the 132-char budget, and the rail (240–640px,
[`ResizeHandle.tsx:3-4`](../../../src/renderer/shell/rightrail/ResizeHandle.tsx#L3-L4))
stays sized for a reference list rather than having to host a render surface too.

### Surfacing the lint

`MacroStudio` computes `const warnings = useMemo(() => lintTemplate(st.value), [st.value])`
beside the existing `validation` memo (`MacroStudio.tsx:44`) and passes it to `PreviewPane`
as a new `warnings: MacroWarning[]` prop, alongside the existing `validation`
([`PreviewPane.tsx:20`](../../../src/renderer/panels/macros/studio/PreviewPane.tsx#L20),
passed at `MacroStudio.tsx:204`). `PreviewPane` renders them in `text-cs-warn` directly
below the existing validation block (`PreviewPane.tsx:114-130`). `canSave`
(`MacroStudio.tsx:45`) is untouched.

Without this wiring §3 ships dead — nothing else reads `lintTemplate`.

### Caption

[`PreviewPane.tsx:63-67`](../../../src/renderer/panels/macros/studio/PreviewPane.tsx#L63-L67)
hardcodes `'Replying to Alice · -95dBm / 5.5 snr · 2 hops'` rather than deriving it from
`ctx`. It happens to agree with the sample today — and stops agreeing the moment §1
reshapes the sample path. Derive it from `ctx`.

While there: `ctx` at `:25` is a fresh object on every render, which defeats the `useMemo`
at `:26`. Memoise it on `mode`.

## 9. Testing

| Unit | Project | Location |
| --- | --- | --- |
| `mapPaths` relay split, `length`, `resolveHop` | `unit` (node) | rewrite `tests/unit/macros/contextBuilder.test.ts` |
| Sample paths carry `pk` + `all_hops` | `unit` (node) | rewrite `tests/unit/renderer/panels/macros/sampleContext.test.ts:31-41` |
| `structureOf`, `resolvePath`, `fieldsAt` | `unit` (node) | `tests/unit/macros/structure.test.ts` (new) |
| `lintTemplate` | `unit` (node) | `tests/unit/macros/lint.test.ts` (new) |
| `PlaceholderDrop.toJSON` | `unit` (node) | extend `tests/unit/macros/render.test.ts` |
| Sample path shape / manifest example | `unit` (node) | extend `tests/unit/macros/manifest.test.ts` |
| Filter docs present (`json`, `inspect`) | `dom` (jsdom) | extend `tests/component/macros/MacroReferenceRail.test.tsx` |
| Hover card bodies | `dom` (jsdom) | `tests/component/macros/VariableHoverCard.test.tsx` (new) |
| Context tab | `dom` (jsdom) | extend `tests/component/macros/MacroReferenceRail.test.tsx` |
| Lint warnings rendered in preview | `dom` (jsdom) | extend `tests/component/macros/MacroStudio.test.tsx` |
| Preview caption | `dom` (jsdom) | extend `tests/component/macros/MacroStudio.test.tsx` |
| Single-column layout | `dom` (jsdom) | extend `tests/component/macros/MacroStudio.test.tsx` — `preview-output` and `macro-editor` both present in one column |

`STANDARD_FILTERS` and `FILTER_INSERT` are unexported module-locals of `ReferencePanel.tsx`
(its only export is `ReferencePanel` itself), so §5 cannot be asserted from the `unit`
project — it has to be observed through the rendered Filters tab.

**Required regression cases:**

- A direct path (`pathHex` empty) yields `length: 0`, `hops: []`, and
  `all_hops.length === 2`.
- `{{ paths.first.hops | map: "short_id" | join: " → " | default: "direct" }}` renders
  `direct` for a direct path and `a1 → 37 → a8` for a 3-relay path.
- `resolveHop` returns `{name: null, pk: null}` when two repeaters share the prefix, and
  the repeater's name and pubkey when exactly one does.
- `resolveHop` **ignores a `kind: 'chat'` contact whose pubkey matches the prefix** — both
  when it is the only match (must not name a phone as a relay) and when it collides with a
  real repeater (must not manufacture ambiguity that the Path viewer does not show).
- `resolveHop('')` returns `{name: null, pk: null}` even when exactly one repeater exists.
- `{{ paths.first.hops.first.short_id }}` throws on a direct path (documenting the
  indexing hazard, not endorsing it).
- `{{ paths.first.hops | map: "pk" | join: "," }}` — the original failing macro — now
  produces **no warning** and renders resolved pubkeys.
- `{{ paths.first.hops | map: "pubkey" }}` produces one warning suggesting `pk`.
- `{{ paths.first.hops | where: "kind", "hop" | map: "short_id" }}` still produces no
  warnings (a redundant but harmless filter after §1).
- `{{ paths.size }}`, `{{ nums | sort }}`, `{% assign z = paths.first %}{{ z.hops }}`, and
  `{% for h in paths.first.hops %}{{ h.short_id }}{% endfor %}` each produce no warnings.
- `lintTemplate` returns `[]` for `'{{ paths.'` and `'{{ paths | nope }}'` rather than
  throwing, and never affects `validateTemplate`'s result.
- `structureOf` reports hop `name` and `pk` as `string | null` (requires §1's two-hop
  sample, one resolved and one not).

**Three existing tests encode the old contract and must be deliberately rewritten**, not
preserved. All three pass today:

- `tests/unit/macros/contextBuilder.test.ts:91` asserts `hops.map((h) => h.name)` equals
  `['Alice', 'Me']` — i.e. that `hops` contains the endpoints. After §1 those are
  `all_hops`.
- `tests/unit/macros/contextBuilder.test.ts:94-103` ("never copies the wire-null pk")
  asserts every hop's `.pk` is `undefined`. §1 makes `pk` a real, locally-resolved field;
  the replacement asserts resolution, the repeater-only filter, and the ambiguity rule.
- `tests/unit/renderer/panels/macros/sampleContext.test.ts:31-41` ("path hops never carry
  pk, so preview matches live (pk is always null on the wire)") loops `replyContext()` and
  `worstCaseContext()` asserting `hop.pk` is `undefined`. §1 changes both sample paths to
  carry `pk`, so line 36 fails on `'a137f2…'` and on `null` alike. Its title states the
  exact contract §1 inverts, so it is rewritten rather than patched — the replacement
  asserts that the sample carries one resolved and one unresolved relay hop, which is what
  §2 depends on for nullability.

`tests/unit/macros/manifest.test.ts:16-20` (the `paths` example contains `short_id`, not
`pk`) still passes — the new example uses `short_id`. `manifest.test.ts:22-28` ("no
top-level nulls") constrains §1's sample change to the nested level only.
`tests/integration/api/macros.routes.test.ts:44` covers the manifest route and will see any
manifest change.

**Constraints this suite imposes**, all verified in this worktree:

- No `globals: true` — import `describe/it/expect` from `vitest` in every file.
- The `dom` project's include glob is `*.test.tsx` only; a `.ts` file there never runs.
- `jest-dom` is **not installed** — assert with `toBeTruthy()`, never `toBeInTheDocument()`.
- `@testing-library/user-event` is **not a dependency**; all interaction is `fireEvent`.
- There is **no test anywhere that opens a Radix hover card and asserts on its content**.
  The two established patterns are forcing a controlled `open` prop and querying the portal
  by text, or asserting only the trigger via
  `container.querySelector('[data-slot="hover-card-trigger"]')`. This is why the card bodies
  must be standalone prop-driven components.
- `tests/component/setup.ts` stubs `matchMedia` and `ResizeObserver` but **not** `DOMRect`,
  `getBoundingClientRect`, or `PointerEvent`.
- Zero snapshots exist in the repo; assert explicit values.

**Commands** (worktree — use `npx`, not `pnpm run`):

```
npx vitest run
npx tsc --noEmit
npx biome check src tests
```

All three pass on the current tree.

## 10. Traps

1. **`wrapScope` is top-level only** ([`render.ts:9`](../../../src/shared/macros/render.ts#L9)).
   Nested nulls never become placeholders: `{{ obj.a.x }}` where `a` is null renders `""`
   without throwing. After §1 this matters more, because `hops[].name` and `hops[].pk` are
   routinely null — `map: "name"` on unresolved hops yields empties, and only the Context
   tab distinguishes that from a wrong key.
2. **`.first` on an empty array throws.** `{{ paths.first }}` raises
   `undefined variable: paths.first`. This is not send-mode-only: `mapPaths` returns `[]`
   for a message with no path metadata
   ([`contextBuilder.ts:23-24`](../../../src/main/macros/contextBuilder.ts#L23-L24), fed
   `m.meta?.paths` at `:112`), so the same macro also throws on real replies. Note this is
   about `paths` being empty, not `hops` — a direct path has `hops: []`, which is normal
   and renders fine through `map`/`join`/`default`.
3. **`validateTemplate` bypasses `wrapScope`** — it calls `renderSync` directly
   ([`validate.ts:22`](../../../src/shared/macros/validate.ts#L22)), while `renderTemplate`
   wraps. Validation and preview see different scopes.
4. **`MACRO_CATALOG` is built at module load**
   ([`catalog.ts:18`](../../../src/renderer/panels/macros/lib/catalog.ts#L18)) — manifest
   changes after mount are invisible to the tokenizer.
5. **The renderer builds its own Liquid engine**
   ([`preview.ts:38-40`](../../../src/renderer/panels/macros/lib/preview.ts#L38-L40)).
   Nothing under `src/shared/macros/**` imports `node:*`, so this works — but any engine
   option change affects both processes.
6. **`GET /api/macros/manifest` has no production UI call site** — the UI imports
   `getManifest()` statically. A client wrapper exists but is never invoked
   ([`api.ts:286`](../../../src/renderer/lib/api.ts#L286)), and the route is covered by
   `tests/integration/api/macros.routes.test.ts:44`.
7. **`PreviewMode` is declared twice** — `studio/useStudio.ts:7` and `lib/tokenize.ts:42`.
8. **Prefix collisions are common at `hash_mode: 1`** — a two-hex-char prefix has 256
   values, so `resolveHop` will often find several repeaters and correctly return nulls.
   Macro output is transmitted, so a wrong operator name is worse than a blank. Note the
   candidate list must be repeaters only (§1); widening it to all contacts silently changes
   both the ambiguity rate and what a match can name.
9. **Worktree tooling:** `git add`/`commit` under `.claude/worktrees/` need the sandbox
   disabled; run tooling via `npx`.

## 11. Sequencing

§1 lands first — it changes the data every other section derives from, and its sample-context
change is what gives §2 a non-empty `hops` array to describe.

Then §2–§5, which are independent of the UI (pure modules, a one-line fix, a doc list).
§6–§8 depend on §2 and can proceed in parallel with each other. §8's "Surfacing the lint"
depends on §3 and is what makes the lint user-visible — without it §3 ships dead.
