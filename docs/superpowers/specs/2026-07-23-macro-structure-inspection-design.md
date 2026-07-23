# Macro Structure Inspection — Debugging What a Variable Actually Contains — Design

- **Date:** 2026-07-23
- **Branch/worktree:** `feat/custom-macros` (`.claude/worktrees/feat+custom-macros`)
- **Status:** Approved shape, pending spec review
- **Builds on:** [2026-06-21-custom-macros-design.md](2026-06-21-custom-macros-design.md) (the Studio, Reference rail, and preview surfaces this change extends)

## Summary

A macro author wrote `{{ paths.first.hops | map: "pk" | join: "," }}` and got `","`
back. No error, no hint. Reaching for `{{ paths.first.hops }}` to find the right field
name produced `[object Object][object Object]`. There is currently no way, anywhere in
the app, to discover what fields an object in the macro context actually has.

This change makes context structure visible in three places that share one derivation:
a **hover card** on every variable and filter in the Reference rail, a **Context tab**
next to Variables and Filters, and a **non-blocking lint warning** in the Studio preview
when a template names a property that does not exist.

Every liquidjs behaviour claim below was executed against this worktree's
`node_modules/liquidjs` (10.27) using the exact options from
[`engine.ts:17-24`](../../../src/shared/macros/engine.ts#L17-L24).

## The failure, precisely

Three independent defects combined.

**1. No `pk` field exists.** `MacroPathHop` is `{kind, short_id, name}`
([`types.ts:8-16`](../../../src/shared/macros/types.ts#L8-L16)), and the type carries a
four-line comment explaining why: the full pubkey is not on the wire, only a 1–3 byte
prefix, so `short_id` is the only key identity available.
[`contextBuilder.ts:30`](../../../src/main/macros/contextBuilder.ts#L30) builds exactly
those three keys. The user's field name was a guess, made because nothing in the UI shows
the shape.

**2. `map` silently swallows the typo.** liquidjs's `map` calls
`_getFromScope(item, stringify(property), false)` with `strictVariables` hard-coded
`false` (`node_modules/liquidjs/dist/liquid.node.mjs:3372`), so a missing key yields
`undefined` instead of throwing:

| Expression | Result |
| --- | --- |
| `{{ paths.first.hops.first.pk }}` | throws `UndefinedVariableError: undefined variable: paths.first.hops.first.pk` |
| `{{ paths.first.hops \| map: "pk" \| join: "," }}` | renders `","` — no error |

`map`, `sort`, `sort_natural` and `sum` are the only property-taking built-ins that opt
out of strict mode; `where`, `reject`, `has`, `find`, `find_index`, `group_by`,
`where_exp` and `find_exp` all throw correctly. So the silent failure is confined to a
known, enumerable set of four filters.

**3. Bare objects stringify to `[object Object]`.** `Emitter.write` → `stringify` →
`String(value)` (`liquid.node.mjs:71-80`); no `outputEscape` is configured
([`engine.ts:17-24`](../../../src/shared/macros/engine.ts#L17-L24)). The escape hatch —
`{{ x | json }}` — **already works today** but appears in none of the app's three filter
doc lists, so it is undiscoverable.

## Goals

- Every variable and filter row in the Reference rail explains itself on hover, including
  the nested field names of object and array variables.
- A Context tab lets an author browse the whole sample context — field, type, and sample
  value — and insert a path with one click.
- A template naming a property that does not exist produces a **warning with a
  suggestion** in the Studio preview, without blocking save.
- `{{ x | json }}` becomes discoverable and stops lying about absent values.

## Non-goals

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

  One exception, called out honestly: `PlaceholderDrop.toJSON()` (§3) changes what
  `{{ x | json }}` emits for an absent value from `{"text":"?"}` to `"?"` on the shared
  `renderTemplate` path, so a saved macro piping a null variable through `json`/`inspect`
  will send different text. Intended and small, but it is a runtime change.
- **Whole-template filter analysis.** Check (b) walks `{{ }}` output nodes only — the
  same boundary the tokenizer already draws (`scan()` only recognises `{{`,
  [`tokenize.ts:169-190`](../../../src/renderer/panels/macros/lib/tokenize.ts#L169-L190)).
  Check (a) is whole-template by construction and that is intentional:
  `globalVariableSegmentsSync` reports `paths.first.hops` from
  `{% for h in paths.first.hops %}` even with no `{{ }}` in the template, and a bad path
  there deserves the same warning.
- **Resolving a real `pk` on hops.** The renderer's own `MessageHop` does carry `pk`
  ([`HopRow.tsx:33`](../../../src/renderer/components/path/HopRow.tsx#L33)) because it
  resolves prefixes against contacts at display time. Whether the macro context should do
  the same is a data-model question, out of scope here.
- Showing the *real* runtime context of a specific message. That is built in main
  ([`contextBuilder.ts:89-114`](../../../src/main/macros/contextBuilder.ts#L89-L114)) and
  never crosses the boundary; `POST /api/macros/render` returns only the rendered string
  ([`routes.ts:956`](../../../src/main/api/routes.ts#L956)). All inspection is of the
  *sample* context.

## Decisions

| Decision | Choice |
| --- | --- |
| Structure source | **Derived at runtime** from `buildSampleContext()`, not authored on `MacroVariable` |
| Lint delivery | **Separate `lintTemplate`**, not folded into `validateTemplate` |
| Lint severity | **Warning** — never blocks save |
| Lint scope | Variable paths anywhere in the template (the analysis API sees `{% %}` too); filter key-args in `{{ }}` output nodes only |
| Lint context | Always `buildSampleContext()`, taken internally — never the current preview mode |
| Suggestions | Alias table first, bounded Levenshtein as fallback |
| Inspector home | **Third tab in the Reference rail**, not the Preview pane |
| Inspector contents | Field name, **sample** type, and sample value |
| Debug filter | Document the existing `json`/`inspect`; add no new filter |
| Placeholder JSON | Add `toJSON()` to `PlaceholderDrop` |
| Hover card bodies | Standalone components — body extracted like `OwnerCardPopover`, but props-in rather than store-in |

### Why derive rather than author

An explicit `fields?: {name, type, nullable}[]` on `MacroVariable` would be more
expressive — it could state that `name` is nullable, or that `short_id` is what you want
instead of `pk`. It would also be a third hand-maintained list that must track
`types.ts` and `contextBuilder.ts`. The repo already demonstrates this failure mode:
filter *registration* ([`filters.ts:48,54,60`](../../../src/shared/macros/filters.ts#L48))
and filter *docs* ([`manifest.ts:87-106`](../../../src/shared/macros/manifest.ts#L87-L106))
are maintained in parallel with nothing enforcing agreement, which is exactly why `json`
and `inspect` work but are documented nowhere.

Deriving from `buildSampleContext()` cannot drift, because it is the same object the
preview renders against. The cost is honesty about types: nullability is recovered only
where the sample varies across array elements, and never for top-level variables (§1).

### Why the lint is separate from validation

`validateTemplate` feeds two consumers that must keep their current meaning:

- `canSave` in [`MacroStudio.tsx:45`](../../../src/renderer/panels/macros/MacroStudio.tsx#L45)
- `assertValid` in [`store.ts:15-18`](../../../src/main/macros/store.ts#L15-L18), thrown
  on add/update and surfaced as HTTP 400 ([`routes.ts:923,944`](../../../src/main/api/routes.ts#L923))

Adding property warnings to `ValidateResult.errors` would make a macro with a suspect
property name **unsaveable** — including macros that are correct but use a path the
sample context cannot represent. A separate `lintTemplate` called only from the Studio
keeps blocking validation exactly as it is.

## 1. `src/shared/macros/structure.ts` (new)

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
dynamic segments as nested arrays, and §2's two checks need the *failing segment index*
(check a) and the *resolved node* (check b) respectively — neither expressible as
`string[] | null`. Verified: `globalVariableSegmentsSync('{{ paths[0].hops[1].short_id }}')`
→ `[["paths",0,"hops",1,"short_id"]]`; `'{{ a[b.c] }}'` → `[["a",["b","c"]],["b","c"]]`.

Behaviour:

- **Array element shapes merge across all items.** Merging unions the observed types per
  key, so a field seen as both `string` and `null` reports `string | null`, and a key
  present on only some elements is still listed.

  **This recovers nullability only where the sample actually varies.** Both sample hops
  carry non-null names
  ([`manifest.ts:146-147`](../../../src/shared/macros/manifest.ts#L146-L147)), so `name`
  derives as `string`, not `string | null`, even though real hops carry `name: string | null`
  ([`types.ts:15`](../../../src/shared/macros/types.ts#L15),
  [`contextBuilder.ts:30`](../../../src/main/macros/contextBuilder.ts#L30)). At the top
  level it is worse: 24 of the 25 `MacroContext` fields are `| null`
  ([`types.ts:28-54`](../../../src/shared/macros/types.ts#L28-L54)), but
  `tests/unit/macros/manifest.test.ts:22-28` asserts `buildSampleContext()` has no
  top-level nulls, so no top-level variable can ever derive as nullable in reply mode.

  The type column therefore reports *what the sample contains*, and the Context tab
  labels it **"sample type"**, not declared type. To make the hop case honest, **add a
  third sample hop with `name: null`** to `buildSampleContext()` — which is also what
  §8's fourth regression case requires.
- **Path resolution steps through arrays and pseudo-properties.**
  `fieldsAt(root, ['paths','first','hops'])` descends `array → element` for the Liquid
  pseudo-properties `first` and `last`, steps through a numeric index segment, and
  resolves `size` to `{kind:'scalar', type:'number'}` on arrays, strings **and** plain
  objects. `size` is not optional: it is advertised to authors by the app's own
  `STANDARD_FILTERS`
  ([`ReferencePanel.tsx:41`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L41)),
  and without it `{{ paths.size }}` warns on a correct macro. Verified:
  `{{ paths.size }}` → `1`, `{{ message_body.size }}` → `11`,
  `{{ paths.first.size }}` → `5` (object key count), `{{ paths.first.hops.size }}` → `2`.
  Note `first`/`last` are array-only while `size` also applies to strings and objects.
- **`PlaceholderDrop` maps to `unknown`** via the existing `isPlaceholder` guard
  ([`placeholder.ts:19-21`](../../../src/shared/macros/placeholder.ts#L19-L21)). This is
  a defensive branch, not a live path: placeholders exist only inside `wrapScope` at
  render time ([`render.ts:6-11`](../../../src/shared/macros/render.ts#L6-L11)), and both
  §2 and §5 pass a raw `MacroContext` where send-mode nulls are plain `null`.
- Non-JSON values (`Date`, `Map`, `RegExp`, functions, `BigInt`) do not occur in
  `MacroContext` today — every field is string, number, null, or a plain object
  ([`types.ts:26-55`](../../../src/shared/macros/types.ts#L26-L55)) — but `structureOf`
  degrades them to `unknown` rather than throwing.

## 2. `src/shared/macros/lint.ts` (new)

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
  flag `paths.first.hops` — the manifest's own flagship example
  ([`manifest.ts:82`](../../../src/shared/macros/manifest.ts#L82)) — the moment the
  author toggled the preview.
- The preview toggle is a preview control, not a declaration of the macro's mode:
  `MacroTemplate` ([`types.ts:59-68`](../../../src/shared/macros/types.ts#L59-L68)) has
  no mode field.

**`lintTemplate` must be total.** It runs on every keystroke, the same shape as the
`validateTemplate` memo at
[`MacroStudio.tsx:44`](../../../src/renderer/panels/macros/MacroStudio.tsx#L44). Both
APIs it uses throw on a partially-typed template — verified: `'{{ paths.'` throws
`output "{{ paths." not closed` and `'{{ paths | nope }}'` throws `undefined filter: nope`
from *both* `parse` and the analysis call. Wrap both in try/catch and return `[]` when the
template does not parse; parse failures are `validateTemplate`'s job to report and the
lint stays silent. `validate.ts:16-20` already guards the same way.

Two checks, both resolved against `structureOf(buildSampleContext())`.

**Whenever resolution reaches an array whose `element` is `null`, both checks skip rather
than warn** — an empty sample is not evidence the property is wrong.

**(a) Variable paths.** `engine.globalVariableSegmentsSync(template)` returns
`[["paths","first","hops"]]` for the failing macro. The `global*` variant is **mandatory**:
plain `variableSegmentsSync` returns template-local names alongside globals — verified,
`{% for h in paths.first.hops %}{{ h.short_id }}{{ forloop.index }}{% endfor %}` yields
`[["paths","first","hops"],["h","short_id"],["forloop","index"]]` from the plain call but
only `[["paths","first","hops"]]` from the global one — so it would false-positive on
every `{% assign %}` local, `{% for %}` loop variable, `{% capture %}` name, and on
`forloop` itself.

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

For each filter in `PROPERTY_FILTERS` (`map`, `where`, `sort`, `sort_natural`,
`group_by`, `sum`), resolve the piped-in expression's structure **through the preceding
filter chain**, take its `element` shape, and check the quoted key against it.

Resolving the head variable alone is wrong for any filter after the first —
`{{ paths | map: "hops" | first | map: "short_id" | join: "," }}` renders `aa,bb`, but
the second `map` checked against `MacroPath`'s keys would false-positive, and
`{{ paths.first.hops | group_by: "kind" | map: "items" | size }}` renders `2` though
`items` is not on `MacroPathHop`. Model only the shape transforms this design needs —
`map` → element becomes that field's node; `group_by` → `[{name, items}]`; `first`/`last`
→ unwrap; `where`/`reject`/`sort`/`sort_natural` → preserve — and **abandon check (b) for
the rest of the chain** the moment an unmodelled filter appears.

Per-filter argument rules, which are not uniform:

- `sort`, `sort_natural` and `sum` take the key **optionally** (`liquid.node.mjs:3355-3362,
  3376-3383`) — `{{ nums | sort }}` and `{{ hops | sum }}` are correct and must not warn.
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
therefore an **explicit alias table consulted first** (`pk`/`pubkey`/`key`/`id` →
`short_id`), falling back to bounded Levenshtein (≤2) over the available field names. The
alias table is a handful of entries keyed to the one mistake this feature exists for; it
is not the "third hand-maintained list" the §Why-derive section rejects, because it never
has to track `types.ts`.

```
map: "pk" — hops[] has no "pk". Did you mean short_id? (kind, short_id, name)
```

**Known gaps**, documented in the module header: dynamic paths (`a[b.c]`) are skipped
rather than guessed at; filters inside `{% %}` tags are not walked; a key that exists on
only some array elements is accepted; an empty sample array disables checking below it.

## 3. `PlaceholderDrop.toJSON()`

`wrapScope` replaces top-level nulls with `PlaceholderDrop`
([`render.ts:6-11`](../../../src/shared/macros/render.ts#L6-L11)). `Drop` has no
`toJSON`, so `JSON.stringify` walks own enumerable fields and the constructor's parameter
property ([`placeholder.ts:4`](../../../src/shared/macros/placeholder.ts#L4)) surfaces.
`valueOf()` is not consulted by the json filters. Verified, using `sender_pos` in send
mode (a reply-only variable that `sendContext()` actually nulls,
[`sampleContext.ts:14-18`](../../../src/renderer/panels/macros/lib/sampleContext.ts#L14-L18)):

| | `{{ sender_pos \| json }}` | `{{ sender_pos }}` |
| --- | --- | --- |
| today | `{"text":"?"}` | `?` |
| with `toJSON()` | `"?"` | `?` |

One method. Without it, the debug filter this change is about to advertise misreports
every absent value. Bare output, `liquidMethodMissing` property access, the `default`
filter, and the `isPlaceholder` passthroughs in
[`filters.ts:49-50,55-56,61`](../../../src/shared/macros/filters.ts#L49-L50) are all
unaffected — verified.

## 4. Documenting `json` / `inspect`

Both are registered built-ins under `strictFilters: true`, with signature
`(value, space = 0)`; `{{ x | json: 2 }}` pretty-prints. `inspect` is identical except
that it replaces circular references with `"[Circular]"`.

Add both to `STANDARD_FILTERS` and `FILTER_INSERT`
([`ReferencePanel.tsx:11-42`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L11-L42)),
with `| json: 2` and `| inspect` as the insert stubs. `STANDARD_FILTERS` rather than
`MACRO_FILTERS`, because these are stock Liquid, not MeshCore filters — and adding to
`MACRO_FILTERS` would paint them teal as custom filters via
[`catalog.ts:11`](../../../src/renderer/panels/macros/lib/catalog.ts#L11).

No new filter is introduced. The Context tab covers "show me the shape"; `json` covers
"show me this expression's value mid-pipeline"; a third `structure` filter would earn its
place only if the first two prove insufficient.

## 5. Context tab in the Reference rail

The rail gains a third tab: `Variables | Filters | Context`
([`ReferencePanel.tsx:52,126-142`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L126-L142)).

The rail rather than the Preview pane, because it is tall and narrow (right shape for a
tree), it already has a search box, it already receives `previewMode` over the studio
bridge, and the Preview pane already carries output, budget meter and validation in one
scroller.

Contents: the sample context for the current preview mode — `replyContext()` or
`sendContext()`
([`sampleContext.ts:7-18`](../../../src/renderer/panels/macros/lib/sampleContext.ts#L7-L18))
— rendered as an expandable tree of field, **sample type**, and sample value. Objects and
arrays collapse; scalars show their value. Clicking a row inserts its dotted path through
the bridge's existing `insertText`.

Unlike the lint, the tab **does** follow the preview toggle: its job is to show what the
author will actually get in each mode, and send mode is where it earns its keep — ten
variables are null there
([`sampleContext.ts:16`](../../../src/renderer/panels/macros/lib/sampleContext.ts#L16)),
and the tab shows plainly which.

Showing values as well as types is what makes this a debugging tool: seeing
`short_id  string  "aa"` next to `name  string|null  "Alice"` answers both "what is it
called" and "what does it look like" in one glance — and `string|null` only appears
because §1 adds a sample hop carrying `name: null`.

## 6. Hover cards

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
(`OwnerCardPopover.tsx:91-101`), which is exactly the untestable shape §8 forbids.
Prop-driven is a testability requirement here, not a style preference.

**Variable card:** name, type badge, availability, the **full untruncated** description
(the row truncates it at `:115`), `example`, and — for object and array types — the
structure tree from §1.

**Filter card:** name, description, `signature`, and `example` **where present**. MeshCore
rows are `MacroFilterDoc` ([`types.ts:80-85`](../../../src/shared/macros/types.ts#L80-L85))
and carry all four; the seven standard rows are the module-local `FilterDoc`
([`ReferencePanel.tsx:24-28`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L24-L28))
with no `example` field, so the prop must be optional.

`MacroVariable.example` and `MacroFilterDoc.signature`/`example` are populated in the
manifest and **rendered nowhere in the app today**. The `paths` example
([`manifest.ts:82`](../../../src/shared/macros/manifest.ts#L82)) is
`{{ paths.first.hops | where: "kind", "hop" | map: "short_id" | join: "," }}` — the exact
incantation this change exists because someone could not find. Surfacing these fields is
most of the value for none of the work.

**Trigger placement.** `InsertRow` serves all three row surfaces (`:110`, `:177`, `:191`)
and takes only `{label, onInsert, children}`
([`ReferencePanel.tsx:69`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L69)),
spreading nothing. So `<HoverCardTrigger asChild>` wrapped *around* `InsertRow` would
silently drop `onPointerEnter`/`onPointerLeave`/`onFocus`/`data-state` and the card would
simply never open — no warning, since React 19 treats `ref` as an ordinary prop.

Instead, `InsertRow` gains a `hoverCard?: React.ReactNode` prop; when present it wraps its
own `<button>` (`:71-82`) in
`<HoverCard><HoverCardTrigger asChild>…</HoverCardTrigger><HoverCardContent>{hoverCard}</HoverCardContent></HoverCard>`.
Each call site supplies the right body.

**Props**, matching the rail-adjacent consumer
([`ChannelPeople.tsx:61-73`](../../../src/renderer/shell/rightrail/sections/ChannelPeople.tsx#L61-L73)):
`openDelay={150} closeDelay={100}`, `side="left"`, `sideOffset={8}`,
`collisionPadding={8}` (the rail list is a scroller,
[`ReferencePanel.tsx:160`](../../../src/renderer/panels/macros/studio/ReferencePanel.tsx#L160)),
and `className="w-auto max-w-80 p-3"` to override the baked-in `w-64 p-4`
([`hover-card.tsx:27`](../../../src/renderer/components/ui/hover-card.tsx#L27)).
`OwnerCard` deliberately differs (`openDelay={200} closeDelay={120}`,
`align="start" side="right"`, no `collisionPadding`, `w-72`) and is not the model here;
`max-w-80` is a new value, not a copied one. `side` always points away from the rail, and
delays must be set explicitly or Radix's 700ms default applies.

**Typography:** section headings `font-mono text-[10px] uppercase tracking-wider`;
identifiers `font-mono text-[12px]`; values `font-mono text-[11px]`; descriptions
`text-[11px] text-cs-text-muted`; type badges
`rounded bg-cs-bg-3 px-1 font-mono text-[9px] text-cs-text-muted`.

Note the badge uses `text-cs-text-muted`, **not** the `text-cs-text-dim` the existing rows
use: this repo has already measured dim-on-bg-3 at 3.76:1 dark / 3.03:1 light, both under
AA, while muted clears it at 8.15 / 6.01
([`PathHashBadge.tsx:15-16`](../../../src/renderer/components/PathHashBadge.tsx#L15-L16)).
Token hues come from
[`tokenColors.ts:6-16`](../../../src/renderer/panels/macros/lib/tokenColors.ts#L6-L16).
`cs-error` is not a real token — the danger token is `cs-danger`.

**Accessibility:** `ChannelPeople`'s trigger is a `<span>` with no `tabIndex`, so Radix's
focus-open never fires there. (`OwnerCard`'s trigger `<div>` contains a real `<button>`
and Radix's `onFocus` bubbles, so that card *is* already keyboard-openable.) Because the
Reference triggers are real buttons, focus-open works for free and these cards become
keyboard-reachable. Tab-stepping the list will pop cards; that is the intended trade and
is why `openDelay` stays at 150ms rather than 0.

## 7. Preview pane

### Surfacing the lint

`MacroStudio` computes `const warnings = useMemo(() => lintTemplate(st.value), [st.value])`
beside the existing `validation` memo
([`MacroStudio.tsx:44`](../../../src/renderer/panels/macros/MacroStudio.tsx#L44)) and
passes it to `PreviewPane` as a new `warnings: MacroWarning[]` prop, alongside the
existing `validation`
([`PreviewPane.tsx:20`](../../../src/renderer/panels/macros/studio/PreviewPane.tsx#L20),
passed at `MacroStudio.tsx:204`). `PreviewPane` renders them in `text-cs-warn` directly
below the existing validation block (`PreviewPane.tsx:114-130`). `canSave`
([`MacroStudio.tsx:45`](../../../src/renderer/panels/macros/MacroStudio.tsx#L45)) is
untouched.

Without this wiring §2 ships dead — nothing else reads `lintTemplate`.

### Caption

[`PreviewPane.tsx:63-67`](../../../src/renderer/panels/macros/studio/PreviewPane.tsx#L63-L67)
hardcodes `'Replying to Alice · -95dBm / 5.5 snr · 2 hops'` rather than deriving it from
`ctx`. It happens to agree with the sample today — and stops agreeing the moment §1 adds a
third sample hop. Shipping a context inspector beside a caption that invents its context is
worse than either alone, so derive it from `ctx`.

While there: `ctx` at `:25` is a fresh object on every render, which defeats the `useMemo`
at `:26` and re-renders the preview on every parent render. Memoise it on `mode`.

## 8. Testing

| Unit | Project | Location |
| --- | --- | --- |
| `structureOf`, `resolvePath`, `fieldsAt` | `unit` (node) | `tests/unit/macros/structure.test.ts` (new) |
| `lintTemplate` | `unit` (node) | `tests/unit/macros/lint.test.ts` (new) |
| `PlaceholderDrop.toJSON` | `unit` (node) | extend `tests/unit/macros/render.test.ts` |
| Third sample hop / no top-level nulls | `unit` (node) | extend `tests/unit/macros/manifest.test.ts` |
| Filter docs present (`json`, `inspect`) | `dom` (jsdom) | extend `tests/component/macros/MacroReferenceRail.test.tsx` — assert the Filters tab renders both rows |
| Hover card bodies | `dom` (jsdom) | `tests/component/macros/VariableHoverCard.test.tsx` (new) |
| Context tab | `dom` (jsdom) | extend `tests/component/macros/MacroReferenceRail.test.tsx` |
| Lint warnings rendered in preview | `dom` (jsdom) | extend `tests/component/macros/MacroStudio.test.tsx` |
| Preview caption | `dom` (jsdom) | extend `tests/component/macros/MacroStudio.test.tsx` |

`STANDARD_FILTERS` and `FILTER_INSERT` are unexported module-locals of `ReferencePanel.tsx`
(the file's only export is `ReferencePanel` itself), so §4 cannot be asserted from the
`unit` project — it has to be observed through the rendered Filters tab.

**Required regression cases:**

- `{{ paths.first.hops | map: "pk" | join: "," }}` produces exactly one warning naming
  `pk` and suggesting `short_id` **via the alias table** (Levenshtein alone would suggest
  `kind`).
- `{{ paths.first.hops | where: "kind", "hop" | map: "short_id" | join: "," }}` produces
  no warnings.
- `{{ paths.size }}`, `{{ nums | sort }}`, `{% assign z = paths.first %}{{ z.hops }}`, and
  `{% for h in paths.first.hops %}{{ h.short_id }}{% endfor %}` each produce no warnings.
- `lintTemplate` returns `[]` for `'{{ paths.'` and `'{{ paths | nope }}'` rather than
  throwing.
- `lintTemplate` never affects `validateTemplate`'s result for the same template.
- `structureOf` reports `name` as `string | null` for the hop array (requires the third
  sample hop from §1).

**Constraints this suite imposes**, all verified in this worktree:

- No `globals: true` — import `describe/it/expect` from `vitest` in every file.
- The `dom` project's include glob is `*.test.tsx` only; a `.ts` file there never runs.
- `jest-dom` is **not installed** — assert with `toBeTruthy()`, never `toBeInTheDocument()`.
- `@testing-library/user-event` is **not a dependency**; all interaction is `fireEvent`.
- There is **no test anywhere that opens a Radix hover card and asserts on its content**.
  The two established patterns are forcing a controlled `open` prop and querying the
  portal by text, or asserting only the trigger via
  `container.querySelector('[data-slot="hover-card-trigger"]')`. This is why the card
  bodies must be standalone prop-driven components: they get tested directly, and the
  trigger wiring gets tested by the existing pattern.
- `tests/component/setup.ts` stubs `matchMedia` and `ResizeObserver` but **not** `DOMRect`,
  `getBoundingClientRect`, or `PointerEvent`.
- Zero snapshots exist in the repo; assert explicit values.

Existing tests that constrain this work: `tests/unit/macros/contextBuilder.test.ts:94-103`
asserts every hop's `.pk` is `undefined`, and `tests/unit/macros/manifest.test.ts:16-20`
asserts the `paths` example contains `short_id` and not `pk` — both must keep passing.
`tests/unit/macros/manifest.test.ts:22-28` ("no nulls") constrains §1's third-hop change to
the *nested* level only. `tests/integration/api/macros.routes.test.ts:44` covers the
manifest route and will see any manifest change.

**Commands** (worktree — use `npx`, not `pnpm run`):

```
npx vitest run
npx tsc --noEmit
npx biome check src tests
```

All three pass on the current tree.

## 9. Traps

1. **`wrapScope` is top-level only** ([`render.ts:9`](../../../src/shared/macros/render.ts#L9)).
   Nested nulls never become placeholders: `{{ obj.a.x }}` where `a` is null renders `""`
   without throwing. Empty output is therefore ambiguous between "null value" and "wrong
   path" — which the Context tab resolves and the lint partially covers.
2. **`.first` on an empty array throws.** `{{ paths.first }}` raises
   `undefined variable: paths.first`. This is not send-mode-only: `mapPaths` returns `[]`
   for a message with no path metadata
   ([`contextBuilder.ts:23-24`](../../../src/main/macros/contextBuilder.ts#L23-L24), fed
   `m.meta?.paths` at `:112`), so the same macro also throws on real replies. Neither the
   lint (against a 1-path sample) nor the preview reveals it. Out of scope, but the
   Context tab makes the send-mode half visible.
3. **`validateTemplate` bypasses `wrapScope`** — it calls `renderSync` directly
   ([`validate.ts:22`](../../../src/shared/macros/validate.ts#L22)), while
   `renderTemplate` wraps. Validation and preview see different scopes.
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
   `tests/integration/api/macros.routes.test.ts:44`. Enriching the manifest needs no IPC
   work but will surface in that test.
7. **`PreviewMode` is declared twice** — `studio/useStudio.ts:7` and `lib/tokenize.ts:42`.
8. **Worktree tooling:** `git add`/`commit` under `.claude/worktrees/` need the sandbox
   disabled; run tooling via `npx`.

## 10. Sequencing

Units 1–4 are independent of the UI and land first (pure modules, a one-line fix, a sample
hop, and a doc list). Units 5–7 depend on §1 and can proceed in parallel with each other
once it exists. §7's "Surfacing the lint" depends on §2 and is what makes the lint
user-visible — without it §2 ships dead.
