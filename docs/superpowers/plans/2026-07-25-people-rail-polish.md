# People Rail Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the channel right rail's People section per the *People — Full* handoff — 7px identity dot, uncoloured names, mono count/age columns, contact state as the dot's fill, searchable/sortable header — and move the whole app onto a new 12-slot identity ramp with a user-selectable hash input.

**Architecture:** Two pure modules (`identity.ts`, `peopleModel.ts`) hold every decision that can be tested without a DOM; two presentational components (`PeopleRow`, `PeopleControls`) hold the layout; `ChannelPeople.tsx` composes them. The identity ramp lives entirely in CSS custom properties so `contactColor.ts` stays a pure `hash → var-reference` function with no theme argument. No list virtualisation — the rail keeps its single scroll container.

**Tech Stack:** Electron + React 19 + TypeScript, Tailwind v4 (`cs-*` tokens), zustand, shadcn/Radix primitives, Vitest (three projects: `unit` / `integration` / `dom`), Biome.

**Spec:** `docs/superpowers/specs/2026-07-25-people-rail-polish-design.md`. Read it before starting — every section number referenced below points there.

## Global Constraints

- **Worktree:** `/Users/andy/GitHub/andyshinn/coresense/.claude/worktrees/people-rail-polish`, branch `worktree-people-rail-polish`. Run every command from there. Do **not** `cd` to the main checkout.
- **Run tooling via `npx`, not `pnpm <script>`** — `pnpm` scripts reflink-fail in worktrees. Use `npx vitest run --project unit`, `npx tsc --noEmit`, `npx biome check src tests`.
- **Lint scope is `src tests`.** Bare `npx biome check` fails on pre-existing `build/`, `dist/` and `out/` artifacts that are not ours.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared with other worktrees and sessions.
- **Identity ramp hues:** 12 slots, `25 · 55 · 85 · 115 · 145 · 175 · 205 · 235 · 265 · 295 · 325 · 355`. Slot = `djb2(id) % 12`.
- **Ramp lightness rule:** `L_light = 1.30 − L_dark`. Dot `oklch(0.76 0.095 h)` dark / `oklch(0.54 0.090 h)` light. Text+glyph `oklch(0.84 0.060 h)` dark / `oklch(0.46 0.060 h)` light. Avatar fill `oklch(0.30 0.050 h)` dark / `oklch(0.92 0.035 h)` light.
- **Never raise chroma to fix a light-mode value — lower `L`.** Cyan (h=175/205) is gamut-bound below `L≈0.60`.
- **Row geometry is final:** height 24px, gap 8px, padding `0 10px`, dot 7px, volume `30×3` radius 2, count track 26px, age track 30px, action button 20px radius 5 icon 12px.
- **Type sizes are final:** name 12.5/500, count 11, age 10.5, bucket 9, toggle 9.5, search input 11.5, empty state 11.5, header count 10.
- **Count renders at most 3 characters** (SF Mono is 0.618em/char; 4 chars overflow the 26px track at 11px).
- **The row never prints `"ago"`, `"hours"` or `"days"`.** That is the tooltip's job.
- **A null / zero / negative `lastSeenAt` renders `—`, never `1970`.**
- **Default `identityColorMode` is `'byKey'`.**
- **Width threshold is 310px**, not the handoff's 330. `DEFAULT_UI_STATE.rightWidth` becomes 340.
- **Do not add a second `TooltipProvider`** — one is already ambient in `ui/sidebar.tsx:100` at `delayDuration={0}`. Set the delay per `<Tooltip>`.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `style:`).

---

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `src/renderer/lib/identity.ts` | Resolve `fromPk` → pubkey/contact. Hash → ramp slot. Pure; no React, no store. |
| `src/renderer/shell/rightrail/sections/peopleModel.ts` | Roster mapping, age ladder, count abbreviation, buckets, sort, filter. Pure. |
| `src/renderer/hooks/useIdentityHash.ts` | Store-reading bridge: from_pk + mode → hash input. Kept out of `identity.ts` so the pure modules stay importable from Node tests. |
| `src/renderer/hooks/useNowTick.ts` | One interval for the whole list. |
| `src/renderer/shell/rightrail/sections/PeopleRow.tsx` | The 24px grid row + hover actions. Presentational. |
| `src/renderer/shell/rightrail/sections/PeopleControls.tsx` | Search field + the two ToggleGroups. Presentational. |
| `tests/unit/renderer/lib/identity.test.ts` | Resolution + slot. |
| `tests/unit/renderer/shell/peopleModel.test.ts` | Ladder, buckets, sort, filter, abbreviation. |
| `tests/component/settings-appearance.test.tsx` | The new setting saves. |

**Modify**

| File | Change |
|---|---|
| `src/renderer/index.css` | 37 ramp vars, dark + light, plus `@theme` entries. |
| `src/renderer/lib/contactColor.ts` | 10-slot HSL palette → 12-slot var references. |
| `src/shared/types.ts` | `IdentityColorMode`, `AppSettings.identityColorMode`, `UiState.peopleRail`, `rightWidth: 340`. |
| `src/renderer/lib/store.ts` | `peopleQuery` at root; `setPeopleQuery`; `setPeopleRail`. |
| `src/renderer/components/ColoredUsername.tsx` | Mode-aware identity. |
| `src/renderer/components/ContactAvatar.tsx` | Mode-aware identity; new optional `identity` prop. |
| `src/renderer/components/path/SetPathEditor.tsx` | Pass explicit identity for hops. |
| `src/renderer/panels/settings/app/Appearance.tsx` | The new `<Row>`. |
| `src/renderer/shell/rightrail/sections/ChannelPeople.tsx` | Rewritten. |
| `src/renderer/shell/rightrail/sectionsFor.tsx` | `trailing` on `RailSection`. |
| `src/renderer/shell/rightrail/index.tsx` | Render `trailing`; full-bleed body for People. |

**Rewrite**

| File | Why |
|---|---|
| `tests/unit/renderer/lib/contactColor.test.ts` | Asserts `/^hsl\(/`. |
| `tests/component/colored-username.test.tsx` | Asserts truthy inline colour against an empty store. |
| `tests/component/channel-people-section.test.tsx` | Asserts the sub-line, the `UserX` hover card, and a single `role="button"`. |

---

### Task 1: The identity ramp in CSS

**Files:**
- Modify: `src/renderer/index.css` (add after the `:root:not(.dark)` block ending ~line 62, and inside `@theme` ~line 95-108)
- Modify: `src/renderer/lib/contactColor.ts:10-38`
- Test: `tests/unit/renderer/lib/contactColor.test.ts` (rewrite)

**Interfaces:**
- Consumes: nothing.
- Produces: `getNameColor(id: string): NameColor` where `NameColor = { fg: string; bg: string; pillBg: string }` — unchanged shape, so `ColoredUsername` and `ContactAvatar` keep working untouched. Also exports `identitySlotFor(id: string): number` and `djb2(s: string): number`.

- [ ] **Step 1: Rewrite the failing test**

Replace the whole `describe('getNameColor')` block in `tests/unit/renderer/lib/contactColor.test.ts`. Keep the `initialsFor` block **verbatim**.

```ts
import { describe, expect, it } from 'vitest';
import { djb2, getNameColor, identitySlotFor, initialsFor } from '../../../../src/renderer/lib/contactColor';

describe('identitySlotFor', () => {
  it('is deterministic and lands in 0..11', () => {
    for (const name of ['Alice', 'Bob', 'Carol', '🚀 Rocket', '']) {
      const slot = identitySlotFor(name);
      expect(slot).toBe(identitySlotFor(name));
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(12);
    }
  });

  it('uses djb2 modulo 12', () => {
    expect(identitySlotFor('Alice')).toBe(djb2('Alice') % 12);
  });
});

describe('getNameColor', () => {
  it('is deterministic for the same id', () => {
    expect(getNameColor('Alice')).toEqual(getNameColor('Alice'));
  });

  it('returns css var references, not literal colours', () => {
    const c = getNameColor('Bob');
    const slot = identitySlotFor('Bob');
    expect(c.fg).toBe(`rgb(var(--cs-id-fg-${slot}))`);
    expect(c.bg).toBe(`rgb(var(--cs-id-bg-${slot}))`);
    expect(c.pillBg).toBe(`color-mix(in srgb, rgb(var(--cs-id-fg-${slot})) 18%, transparent)`);
  });

  it('never emits an hsl literal', () => {
    for (const name of ['Alice', 'Bob', 'Carol']) {
      expect(getNameColor(name).fg).not.toMatch(/^hsl\(/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/lib/contactColor.test.ts`
Expected: FAIL — `djb2` and `identitySlotFor` are not exported.

- [ ] **Step 3: Rewrite `contactColor.ts` lines 1-38**

Replace everything from the top-of-file comment through the end of `getNameColor`. Leave `initialsFor`, `firstAlnum` and `firstEmoji` (lines 40-73) **untouched**.

```ts
// Deterministic identity→colour mapping. Pure function of the input string, so
// the same identity always lands on the same slot across renders and reloads.
//
// The returned strings are CSS variable *references*, never literal colours:
// the 12-slot ramp has different values in dark and light mode (see the
// --cs-id-* blocks in index.css), and resolving them in CSS keeps this function
// theme-agnostic — no mode argument to thread through callers, and no re-render
// when the theme flips.
//
// The hash INPUT is chosen by the caller, not here: under the 'byKey' identity
// colour mode it is a pubkey, under 'byName' a display name. See lib/identity.ts.

export interface NameColor {
  fg: string;
  bg: string;
  pillBg: string;
}

/** Ramp slot count. Hues are 30° apart: 25, 55, … 355. */
export const IDENTITY_SLOTS = 12;

export function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function identitySlotFor(id: string): number {
  return djb2(id) % IDENTITY_SLOTS;
}

export function getNameColor(id: string): NameColor {
  const slot = identitySlotFor(id);
  const fg = `rgb(var(--cs-id-fg-${slot}))`;
  return {
    fg,
    bg: `rgb(var(--cs-id-bg-${slot}))`,
    pillBg: `color-mix(in srgb, ${fg} 18%, transparent)`,
  };
}
```

- [ ] **Step 4: Add the dark ramp to `index.css`**

Insert inside the existing `:root { … }` block, after the `--cs-hash-3` line (~line 34):

```css
  /* Identity ramp — 12 slots, hues 30° apart, all at one low chroma so no
     identity colour can be mistaken for status (--cs-online, --cs-accent,
     --cs-danger stay exclusively semantic). Dot = oklch(0.76 0.095 h),
     text/glyph = oklch(0.84 0.060 h), avatar fill = oklch(0.30 0.050 h).
     Light-mode counterparts follow L_light = 1.30 - L_dark; see the
     :root:not(.dark) block below. Ratios are vs bg / bg-2 / bg-3. */
  --cs-id-0: 231 153 147; /* h=25  #E79993 — 8.83 / 8.24 / 7.60 */
  --cs-id-1: 224 161 118; /* h=55  #E0A176 — 8.98 / 8.38 / 7.73 */
  --cs-id-2: 205 173 104; /* h=85  #CDAD68 — 9.21 / 8.60 / 7.93 */
  --cs-id-3: 175 185 113; /* h=115 #AFB971 — 9.42 / 8.80 / 8.12 */
  --cs-id-4: 139 193 140; /* h=145 #8BC18C — 9.52 / 8.89 / 8.20 */
  --cs-id-5: 105 197 174; /* h=175 #69C5AE — 9.61 / 8.97 / 8.28 */
  --cs-id-6: 94 195 206; /* h=205 #5EC3CE — 9.58 / 8.95 / 8.26 */
  --cs-id-7: 114 187 229; /* h=235 #72BBE5 — 9.38 / 8.76 / 8.08 */
  --cs-id-8: 148 176 238; /* h=265 #94B0EE — 9.14 / 8.54 / 7.87 */
  --cs-id-9: 181 165 232; /* h=295 #B5A5E8 — 8.95 / 8.36 / 7.71 */
  --cs-id-10: 208 156 211; /* h=325 #D09CD3 — 8.82 / 8.24 / 7.60 */
  --cs-id-11: 226 152 180; /* h=355 #E298B4 — 8.84 / 8.25 / 7.62 */
  --cs-id-fg-0: 239 188 183; /* h=25  #EFBCB7 — 11.85 / 11.07 / 10.21 */
  --cs-id-fg-1: 234 193 166; /* h=55  #EAC1A6 — 11.94 / 11.15 / 10.29 */
  --cs-id-fg-2: 221 200 158; /* h=85  #DDC89E — 12.08 / 11.29 / 10.41 */
  --cs-id-fg-3: 201 208 163; /* h=115 #C9D0A3 — 12.28 / 11.47 / 10.58 */
  --cs-id-fg-4: 179 213 179; /* h=145 #B3D5B3 — 12.33 / 11.51 / 10.62 */
  --cs-id-fg-5: 162 216 200; /* h=175 #A2D8C8 — 12.43 / 11.60 / 10.71 */
  --cs-id-fg-6: 156 214 221; /* h=205 #9CD6DD — 12.32 / 11.50 / 10.61 */
  --cs-id-fg-7: 165 210 237; /* h=235 #A5D2ED — 12.27 / 11.46 / 10.57 */
  --cs-id-fg-8: 184 203 243; /* h=265 #B8CBF3 — 12.13 / 11.33 / 10.45 */
  --cs-id-fg-9: 205 195 238; /* h=295 #CDC3EE — 11.90 / 11.12 / 10.25 */
  --cs-id-fg-10: 223 190 224; /* h=325 #DFBEE0 — 11.85 / 11.07 / 10.21 */
  --cs-id-fg-11: 236 187 204; /* h=355 #ECBBCC — 11.82 / 11.04 / 10.18 */
  --cs-id-bg-0: 68 35 33; /* h=25  #442321 — avatar fill */
  --cs-id-bg-1: 65 39 20; /* h=55  #412714 */
  --cs-id-bg-2: 57 44 12; /* h=85  #392C0C */
  --cs-id-bg-3: 45 49 17; /* h=115 #2D3111 */
  --cs-id-bg-4: 29 52 30; /* h=145 #1D341E */
  --cs-id-bg-5: 10 54 44; /* h=175 #0A362C */
  --cs-id-bg-6: 2 53 58; /* h=205 #02353A */
  --cs-id-bg-7: 16 50 67; /* h=235 #103243 */
  --cs-id-bg-8: 33 45 71; /* h=265 #212D47 */
  --cs-id-bg-9: 48 40 68; /* h=295 #302844 */
  --cs-id-bg-10: 58 37 60; /* h=325 #3A253C */
  --cs-id-bg-11: 65 35 47; /* h=355 #41232F */
  /* Keyless identity. Sits INSIDE the coloured dots' band (dark 7.60-8.28 on
     bg-3) so the dot column reads as an even row of marks — a person without a
     key is a mark without a hue, not a hole. */
  --cs-id-neutral: 188 172 141; /* #BCAC8D — 8.88 / 8.29 / 7.65 */
```

- [ ] **Step 5: Add the light ramp to `index.css`**

Insert inside the existing `:root:not(.dark) { … }` block, after `--cs-hash-3` (~line 61). Avatar glyph-on-fill measures 5.52–5.75:1 light, 8.31–8.41:1 dark — both clear 4.5:1.

```css
  --cs-id-0: 156 89 84; /* h=25  #9C5954 — 5.02 / 4.60 / 3.94 */
  --cs-id-1: 151 96 56; /* h=55  #976038 — 4.93 / 4.51 / 3.87 */
  --cs-id-2: 135 106 41; /* h=85  #876A29 — 4.84 / 4.43 / 3.79 */
  --cs-id-3: 109 117 51; /* h=115 #6D7533 — 4.70 / 4.30 / 3.69 */
  --cs-id-4: 75 124 77; /* h=145 #4B7C4D — 4.65 / 4.26 / 3.65 */
  --cs-id-5: 36 128 108; /* h=175 #24806C — 4.55 / 4.17 / 3.57 (worst dot) */
  --cs-id-6: 12 125 135; /* h=205 #0C7D87 — 4.64 / 4.25 / 3.64 */
  --cs-id-7: 49 119 155; /* h=235 #31779B — 4.70 / 4.30 / 3.69 */
  --cs-id-8: 85 109 163; /* h=265 #556DA3 — 4.86 / 4.45 / 3.81 */
  --cs-id-9: 114 100 158; /* h=295 #72649E — 4.96 / 4.54 / 3.89 */
  --cs-id-10: 137 92 140; /* h=325 #895C8C — 5.03 / 4.60 / 3.94 */
  --cs-id-11: 152 88 113; /* h=355 #985871 — 5.02 / 4.60 / 3.94 */
  --cs-id-fg-0: 118 75 71; /* h=25  #764B47 — 6.96 / 6.37 / 5.46 */
  --cs-id-fg-1: 114 79 55; /* h=55  #724F37 — 6.90 / 6.32 / 5.42 */
  --cs-id-fg-2: 103 85 47; /* h=85  #67552F — 6.84 / 6.26 / 5.36 */
  --cs-id-fg-3: 87 92 52; /* h=115 #575C34 — 6.68 / 6.11 / 5.24 */
  --cs-id-fg-4: 66 97 67; /* h=145 #426143 — 6.60 / 6.04 / 5.18 */
  --cs-id-fg-5: 47 99 86; /* h=175 #2F6356 — 6.56 / 6.01 / 5.15 */
  --cs-id-fg-6: 41 98 104; /* h=205 #296268 — 6.56 / 6.00 / 5.14 (worst text) */
  --cs-id-fg-7: 52 93 117; /* h=235 #345D75 — 6.72 / 6.15 / 5.27 */
  --cs-id-fg-8: 72 88 122; /* h=265 #48587A — 6.76 / 6.18 / 5.30 */
  --cs-id-fg-9: 90 81 118; /* h=295 #5A5176 — 6.94 / 6.35 / 5.45 */
  --cs-id-fg-10: 105 76 107; /* h=325 #694C6B — 7.01 / 6.41 / 5.50 */
  --cs-id-fg-11: 115 74 90; /* h=355 #734A5A — 6.98 / 6.39 / 5.48 */
  --cs-id-bg-0: 251 220 217; /* h=25  #FBDCD9 — avatar fill */
  --cs-id-bg-1: 248 223 207; /* h=55  #F8DFCF */
  --cs-id-bg-2: 239 227 203; /* h=85  #EFE3CB */
  --cs-id-bg-3: 227 232 206; /* h=115 #E3E8CE */
  --cs-id-bg-4: 215 235 215; /* h=145 #D7EBD7 */
  --cs-id-bg-5: 206 237 227; /* h=175 #CEEDE3 */
  --cs-id-bg-6: 203 236 240; /* h=205 #CBECF0 */
  --cs-id-bg-7: 207 233 249; /* h=235 #CFE9F9 */
  --cs-id-bg-8: 217 229 253; /* h=265 #D9E5FD */
  --cs-id-bg-9: 230 224 250; /* h=295 #E6E0FA */
  --cs-id-bg-10: 241 221 242; /* h=325 #F1DDF2 */
  --cs-id-bg-11: 249 219 230; /* h=355 #F9DBE6 */
  --cs-id-neutral: 122 108 82; /* #7A6C52 — 4.87 / 4.46 / 3.82 */
```

- [ ] **Step 6: Register the vars in `@theme`**

Add to the `@theme` block, next to the existing `--color-cs-hash-*` entries (~line 103):

```css
  --color-cs-id-neutral: rgb(var(--cs-id-neutral));
```

Only the neutral needs a Tailwind colour alias — the 12 slots are consumed through inline `style` (the slot is a runtime value, so a Tailwind class cannot name it).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --project unit tests/unit/renderer/lib/contactColor.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Verify nothing else broke**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean. `tests/component/colored-username.test.tsx` **will still pass** (it only asserts `style.color` is truthy, and a `rgb(var(…))` string is truthy). Task 4 rewrites it.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/index.css src/renderer/lib/contactColor.ts tests/unit/renderer/lib/contactColor.test.ts
git commit -m "feat(identity): 12-slot oklch identity ramp as themed CSS vars

Replaces the 10-slot HSL palette with 12 slots at one low chroma, so no
identity colour can be read as status. Values live in CSS custom
properties with a :root:not(.dark) override, keeping getNameColor pure
and theme-agnostic. All 72 values measured; worst dot 3.57:1 (light,
h=175) against a 3:1 bar, worst text 5.14:1 against 4.5:1."
```

---

### Task 2: Identity resolution

**Files:**
- Create: `src/renderer/lib/identity.ts`
- Test: `tests/unit/renderer/lib/identity.test.ts`

**Interfaces:**
- Consumes: `identitySlotFor` from Task 1; `Contact` and `DiscoveredContact` types.
- Produces:
  ```ts
  type IdentitySource = 'contact' | 'discovered' | 'none';
  interface ResolvedIdentity {
    name: string | null;      // null for self / unknown
    pubkey: string | null;
    contactKey: string | null;
    source: IdentitySource;
    ambiguous: boolean;
    blocked: boolean;
  }
  buildDiscoveredNameIndex(rows: DiscoveredContact[]): Map<string, DiscoveredContact[]>
  resolveIdentity(fromPk: string | null | undefined, contacts: Contact[], index: Map<string, DiscoveredContact[]>): ResolvedIdentity
  identityHashInput(r: ResolvedIdentity, mode: IdentityColorMode): string | null   // null ⇒ neutral
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/lib/identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DiscoveredContact } from '../../../../src/shared/contacts/discovered';
import type { Contact } from '../../../../src/shared/types';
import { buildDiscoveredNameIndex, identityHashInput, resolveIdentity } from '../../../../src/renderer/lib/identity';

const PK = 'a'.repeat(64);

const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:abc',
  publicKeyHex: 'abc',
  name: 'alice',
  kind: 'chat',
  ...over,
});

const disc = (over: Partial<DiscoveredContact> = {}): DiscoveredContact => ({
  key: 'c:def',
  publicKeyHex: 'def',
  name: 'bob',
  kind: 'chat',
  firstHeardMs: 1,
  onRadio: false,
  favourite: false,
  blocked: false,
  ...over,
});

const idx = (rows: DiscoveredContact[] = []) => buildDiscoveredNameIndex(rows);

describe('resolveIdentity', () => {
  it('resolves a named poster to a saved contact', () => {
    const r = resolveIdentity('name:alice', [contact()], idx());
    expect(r).toMatchObject({ name: 'alice', pubkey: 'abc', contactKey: 'c:abc', source: 'contact', ambiguous: false });
  });

  it('falls back to the discovered pool when no contact matches', () => {
    const r = resolveIdentity('name:bob', [contact()], idx([disc()]));
    expect(r).toMatchObject({ name: 'bob', pubkey: 'def', source: 'discovered', ambiguous: false });
    expect(r.contactKey).toBeNull();
  });

  it('prefers a saved contact over a discovered row with the same name', () => {
    const r = resolveIdentity('name:alice', [contact()], idx([disc({ name: 'alice', publicKeyHex: 'zzz' })]));
    expect(r.source).toBe('contact');
    expect(r.pubkey).toBe('abc');
  });

  it('treats two discovered nodes sharing a name as unresolved', () => {
    const rows = [disc({ publicKeyHex: 'd1' }), disc({ publicKeyHex: 'd2' })];
    const r = resolveIdentity('name:bob', [], idx(rows));
    expect(r).toMatchObject({ name: 'bob', pubkey: null, source: 'none', ambiguous: true });
  });

  it('matches exactly — case and whitespace differences miss', () => {
    expect(resolveIdentity('name:Alice', [contact()], idx()).source).toBe('none');
    expect(resolveIdentity('name:alice ', [contact()], idx()).source).toBe('none');
  });

  it('carries the blocked flag from the discovered row', () => {
    const r = resolveIdentity('name:bob', [], idx([disc({ blocked: true })]));
    expect(r.blocked).toBe(true);
  });

  it('returns a nameless identity for self and unknown', () => {
    for (const fromPk of [null, undefined, 'unknown']) {
      const r = resolveIdentity(fromPk, [contact()], idx());
      expect(r).toMatchObject({ name: null, pubkey: null, source: 'none' });
    }
  });

  it('routes a raw pubkey straight through, with its contact when saved', () => {
    expect(resolveIdentity(PK, [], idx())).toMatchObject({ pubkey: PK, contactKey: null, source: 'none' });
    const saved = contact({ key: `c:${PK}`, publicKeyHex: PK, name: 'zed' });
    expect(resolveIdentity(PK, [saved], idx())).toMatchObject({ pubkey: PK, contactKey: `c:${PK}`, source: 'contact' });
  });
});

describe('identityHashInput', () => {
  const resolved = resolveIdentity('name:alice', [contact()], idx());
  const unresolved = resolveIdentity('name:nobody', [], idx());

  it('byKey hashes the pubkey when one is known', () => {
    expect(identityHashInput(resolved, 'byKey')).toBe('abc');
  });

  it('byKey returns null (neutral) when no pubkey is known', () => {
    expect(identityHashInput(unresolved, 'byKey')).toBeNull();
  });

  it('byName hashes the display name regardless of resolution', () => {
    expect(identityHashInput(resolved, 'byName')).toBe('alice');
    expect(identityHashInput(unresolved, 'byName')).toBe('nobody');
  });

  it('is neutral for a nameless identity in either mode', () => {
    const self = resolveIdentity(null, [], idx());
    expect(identityHashInput(self, 'byKey')).toBeNull();
    expect(identityHashInput(self, 'byName')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/lib/identity.test.ts`
Expected: FAIL — cannot resolve `src/renderer/lib/identity`.

- [ ] **Step 3: Create `src/renderer/lib/identity.ts`**

```ts
// Resolving a channel poster to a real identity.
//
// MeshCore's channel messages carry NO sender pubkey on the wire — the library
// stores `name:<n>` in from_pk and says so explicitly. The only name→pubkey
// bridges we have are the saved contact list and the advert-derived discovered
// pool, both matched by exact name equality. That is why the identity colour
// mode exists: 'byKey' admits we often don't know who someone is and greys them
// out; 'byName' colours everyone from the string we do have.

import type { DiscoveredContact } from '../../shared/contacts/discovered';
import type { Contact, IdentityColorMode } from '../../shared/types';

export type IdentitySource = 'contact' | 'discovered' | 'none';

export interface ResolvedIdentity {
  /** Display name, or null for self / 'unknown' (which have none). */
  name: string | null;
  pubkey: string | null;
  /** Route key for the contact page (`c:<pkhex>`), when saved. */
  contactKey: string | null;
  source: IdentitySource;
  /** True when the name matched >1 discovered node — treated as unresolved. */
  ambiguous: boolean;
  blocked: boolean;
}

const NONE: ResolvedIdentity = {
  name: null,
  pubkey: null,
  contactKey: null,
  source: 'none',
  ambiguous: false,
  blocked: false,
};

/** Group discovered rows by display name. `name` has no UNIQUE constraint in
 *  discovered_contacts, so this is genuinely one-to-many. */
export function buildDiscoveredNameIndex(rows: DiscoveredContact[]): Map<string, DiscoveredContact[]> {
  const index = new Map<string, DiscoveredContact[]>();
  for (const row of rows) {
    const bucket = index.get(row.name);
    if (bucket) bucket.push(row);
    else index.set(row.name, [row]);
  }
  return index;
}

export function resolveIdentity(
  fromPk: string | null | undefined,
  contacts: Contact[],
  discoveredByName: Map<string, DiscoveredContact[]>,
): ResolvedIdentity {
  if (!fromPk || fromPk === 'unknown') return NONE;

  if (!fromPk.startsWith('name:')) {
    // A raw hex pubkey. Not currently produced for channel posts, but DMs and
    // several other call sites pass one.
    const saved = contacts.find((c) => c.publicKeyHex === fromPk);
    return {
      name: saved?.name ?? null,
      pubkey: fromPk,
      contactKey: saved?.key ?? null,
      source: saved ? 'contact' : 'none',
      ambiguous: false,
      blocked: false,
    };
  }

  const name = fromPk.slice(5);

  const saved = contacts.find((c) => c.name === name);
  if (saved) {
    return {
      name,
      pubkey: saved.publicKeyHex,
      contactKey: saved.key,
      source: 'contact',
      ambiguous: false,
      blocked: false,
    };
  }

  const heard = discoveredByName.get(name);
  if (heard && heard.length === 1) {
    return {
      name,
      pubkey: heard[0].publicKeyHex,
      contactKey: null,
      source: 'discovered',
      ambiguous: false,
      blocked: heard[0].blocked,
    };
  }

  // Either never heard, or >1 node advertises this name. Ambiguous is treated
  // exactly as unresolved: the roster re-broadcasts in full on every advert, so
  // "newest wins" would let a stranger flip someone's hue mid-session.
  return { name, pubkey: null, contactKey: null, source: 'none', ambiguous: (heard?.length ?? 0) > 1, blocked: false };
}

/** The string to hash for this identity's ramp slot, or null for a neutral
 *  (hueless) mark. */
export function identityHashInput(r: ResolvedIdentity, mode: IdentityColorMode): string | null {
  if (mode === 'byName') return r.name;
  return r.pubkey;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/lib/identity.test.ts`
Expected: PASS, 12 tests.

Note: this depends on `IdentityColorMode` existing in `src/shared/types.ts`. If typecheck complains, do Task 3 Step 3 first — it is a two-line type addition.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/identity.ts tests/unit/renderer/lib/identity.test.ts
git commit -m "feat(identity): resolve channel posters to pubkeys via contacts and adverts

Channel posts carry only a display name, so name->pubkey goes through the
saved contact list first and the advert-derived discovered pool second,
both by exact match. A name advertised by two nodes resolves to nothing
rather than picking one, so a stranger's advert cannot flip an existing
person's colour mid-session."
```

---

### Task 3: The `identityColorMode` setting

**Files:**
- Modify: `src/shared/types.ts` (union near `ThemePrefValue` ~line 336; `AppSettings` ~line 361-466; `DEFAULT_APP_SETTINGS` ~line 470)
- Modify: `src/renderer/panels/settings/app/Appearance.tsx`
- Test: `tests/component/settings-appearance.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `type IdentityColorMode = 'byKey' | 'byName'` and `AppSettings.identityColorMode`, read everywhere as `useStore((s) => s.appSettings.identityColorMode ?? 'byKey')`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/settings-appearance.test.tsx`. Read `tests/component/settings-updates.test.tsx` first and mirror its mocking style exactly — if its `vi.mock` path or client shape differs from the sketch below, follow the existing file, not this one.

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppearanceSection } from '@/panels/settings/app/Appearance';

const putAppSettings = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api', () => ({
  api: {
    putAppSettings: (...args: unknown[]) => putAppSettings(...args),
  },
}));

describe('AppearanceSection', () => {
  it('saves a changed identity colour mode', async () => {
    render(<AppearanceSection client={{} as never} />);

    const select = screen.getByDisplayValue('By key (only verified identities)') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'byName' } });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await vi.waitFor(() => {
      expect(putAppSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ identityColorMode: 'byName' }),
      );
    });
  });

  it('warns that byKey leaves channel posters grey', () => {
    render(<AppearanceSection client={{} as never} />);
    expect(screen.getByText(/Posters stay grey until this node hears an advert/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/settings-appearance.test.tsx`
Expected: FAIL — no option labelled "By key (only verified identities)".

- [ ] **Step 3: Add the type**

In `src/shared/types.ts`, beside `ThemePrefValue` (~line 336):

```ts
/** How a person's identity colour is derived.
 *  'byKey'  — hue only when a real pubkey is known; everyone else is neutral.
 *  'byName' — hue from the display name, so everyone gets one. */
export type IdentityColorMode = 'byKey' | 'byName';
```

In `AppSettings`, next to `theme`:

```ts
  identityColorMode: IdentityColorMode;
```

In `DEFAULT_APP_SETTINGS`, next to `theme`:

```ts
  identityColorMode: 'byKey',
```

- [ ] **Step 4: Add the Row to `Appearance.tsx`**

Four edits. All four are required — omitting the `eqAppearance` line means the Save button never enables.

Add the import and options const after `TIME_FORMAT_OPTIONS` (line 25):

```ts
const IDENTITY_COLOR_OPTIONS = [
  { value: 'byKey', label: 'By key (only verified identities)' },
  { value: 'byName', label: 'By name (everyone gets a colour)' },
] as const;
```

Extend the type import on line 2 to include `IdentityColorMode`.

Extend `eqAppearance` (line 27-31):

```ts
const eqAppearance = (a: AppSettingsType, b: AppSettingsType) =>
  a.theme === b.theme &&
  a.messageStyle === b.messageStyle &&
  a.unreadsStyle === b.unreadsStyle &&
  a.timeFormat === b.timeFormat &&
  a.identityColorMode === b.identityColorMode;
```

Extend the `saveApp` patch (line 41-48) with `identityColorMode: d.identityColorMode,`.

Add the `<Row>` after the Theme row (i.e. after line 74):

```tsx
      <Row
        label="Identity colour"
        description="How each person's colour is chosen. By key only colours people whose public key is known, so a colour always means the same node. By name gives everyone a colour derived from their display name."
        warning={
          draft.identityColorMode === 'byKey'
            ? 'Channel posts carry a name, not a key. Posters stay grey until this node hears an advert from them.'
            : undefined
        }
        changed={draft.identityColorMode !== saved.identityColorMode}
        control={
          <Select
            value={draft.identityColorMode}
            options={IDENTITY_COLOR_OPTIONS}
            onChange={(mode) => setDraft((s) => ({ ...s, identityColorMode: mode as IdentityColorMode }))}
          />
        }
      />
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project dom tests/component/settings-appearance.test.tsx && npx tsc --noEmit`
Expected: PASS, 2 tests; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/panels/settings/app/Appearance.tsx tests/component/settings-appearance.test.tsx
git commit -m "feat(settings): add the Identity colour mode preference

Channel posts carry no pubkey, so whether identity colour means 'this
exact node' or 'this display name' is a real user choice rather than
something the app can decide. Defaults to byKey."
```

---

### Task 4: Make `ColoredUsername` and `ContactAvatar` mode-aware

**Files:**
- Modify: `src/renderer/components/ColoredUsername.tsx`
- Modify: `src/renderer/components/ContactAvatar.tsx`
- Test: `tests/component/colored-username.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `resolveIdentity` / `buildDiscoveredNameIndex` / `identityHashInput` (Task 2); `getNameColor` (Task 1); `AppSettings.identityColorMode` (Task 3).
- Produces: `ContactAvatar` gains an optional `identity?: string | null` prop — when provided it overrides the hash input derived from `name`; when explicitly `null` the avatar renders neutral. `ColoredUsername`'s public props are unchanged.

- [ ] **Step 1: Rewrite the failing test**

Replace `tests/component/colored-username.test.tsx` entirely:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ColoredUsername } from '@/components/ColoredUsername';
import { useStore } from '@/lib/store';

const contact = { key: 'c:abc', publicKeyHex: 'abc', name: 'alice', kind: 'chat' as const };

function setMode(identityColorMode: 'byKey' | 'byName') {
  useStore.setState((s) => ({ appSettings: { ...s.appSettings, identityColorMode } }));
}

beforeEach(() => {
  useStore.setState({ contacts: [], discovered: [] });
  setMode('byKey');
});

describe('ColoredUsername', () => {
  it('renders self neutrally as the selfLabel when no name/sender', () => {
    render(<ColoredUsername />);
    expect(screen.getByText('You').style.color).toBe('');
  });

  it('renders an unknown sender as "Unknown", neutral', () => {
    render(<ColoredUsername sender="unknown" />);
    expect(screen.getByText('Unknown').style.color).toBe('');
  });

  it('decodes a name-based sender', () => {
    render(<ColoredUsername sender="name:bob" />);
    expect(screen.getByText('bob')).toBeTruthy();
  });

  describe('byKey', () => {
    it('colours a poster that resolves to a saved contact', () => {
      useStore.setState({ contacts: [contact] });
      render(<ColoredUsername sender="name:alice" />);
      expect(screen.getByText('alice').style.color).toBeTruthy();
    });

    it('leaves an unresolvable poster neutral', () => {
      render(<ColoredUsername sender="name:alice" />);
      expect(screen.getByText('alice').style.color).toBe('');
    });
  });

  describe('byName', () => {
    beforeEach(() => setMode('byName'));

    it('colours a poster even with nothing saved', () => {
      render(<ColoredUsername sender="name:alice" />);
      expect(screen.getByText('alice').style.color).toBeTruthy();
    });

    it('colours a bare name prop', () => {
      render(<ColoredUsername name="carol" />);
      expect(screen.getByText('carol').style.color).toBeTruthy();
    });
  });
});
```

Note the dropped case: the old test 5 exercised `variant="pill"`, which has **no production call site**. Leave the prop in place but do not re-test it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/colored-username.test.tsx`
Expected: FAIL — under `byKey` an unresolvable poster is still coloured, so `'leaves an unresolvable poster neutral'` fails.

- [ ] **Step 3: Add a shared hook — in its own file, not in `identity.ts`**

Create `src/renderer/hooks/useIdentityHash.ts`. It must **not** live in `identity.ts`: `peopleModel.ts` imports `identity.ts`, and `tests/unit/renderer/shell/peopleModel.test.ts` runs in the `unit` project under `environment: 'node'`. Pulling `store.ts` into that import graph drags zustand and the API client into a Node test that has no DOM. Keeping the hook separate is what makes both pure modules testable.

```ts
import { useMemo } from 'react';
import { buildDiscoveredNameIndex, identityHashInput, resolveIdentity } from '../lib/identity';
import { useStore } from '../lib/store';

/** Resolve a raw from_pk to the string that should drive its ramp slot, under
 *  the user's current identity-colour mode. Returns null for a neutral mark. */
export function useIdentityHash(fromPk: string | null | undefined, fallbackName?: string): string | null {
  const mode = useStore((s) => s.appSettings.identityColorMode ?? 'byKey');
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  return useMemo(() => {
    const index = buildDiscoveredNameIndex(discovered);
    const resolved = resolveIdentity(fromPk, contacts, index);
    const hash = identityHashInput(resolved, mode);
    if (hash) return hash;
    // A caller that already knows the display name (ColoredUsername's `name`
    // prop, ContactAvatar's `name`) can still be coloured under byName.
    return mode === 'byName' ? (fallbackName ?? null) : null;
  }, [fromPk, fallbackName, contacts, discovered, mode]);
}
```

`buildDiscoveredNameIndex` is rebuilt per call. That is `O(discovered)` on a list that is hundreds of entries at most, and `useMemo` keys it on the array identity, so it only re-runs when the pool actually changes.

- [ ] **Step 4: Rewrite `ColoredUsername` lines 1-2 and 25-44**

```tsx
import { getNameColor } from '../lib/contactColor';
import { useIdentityHash } from '../hooks/useIdentityHash';
import { cn, deriveSenderName } from '../lib/utils';
```

Replace the body from `let display: string;` through the `const base = …` line:

```tsx
  let display: string;
  let neutral = false;
  if (name !== undefined) {
    display = name;
  } else if (sender === undefined || sender === null) {
    display = selfLabel;
    neutral = true;
  } else {
    const derived = deriveSenderName(sender); // '' for self / 'unknown'
    if (derived === '') {
      display = 'Unknown';
      neutral = true;
    } else {
      display = derived;
    }
  }

  // Under 'byKey' this is the resolved pubkey (null when we've never heard an
  // advert); under 'byName' it's the display name. Self and 'unknown' stay
  // neutral in both modes — they have no identity to colour.
  const hashInput = useIdentityHash(neutral ? null : sender, display);
  const color = neutral || hashInput === null ? null : getNameColor(hashInput);
  const sizeCls = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const base = cn('font-medium leading-tight', sizeCls, (neutral || !color) && 'text-cs-text-dim', className);
```

- [ ] **Step 5: Rewrite `ContactAvatar`**

```tsx
import { getNameColor, initialsFor } from '../lib/contactColor';
import { cn } from '../lib/utils';

interface Props {
  name: string;
  /** Explicit hash input, overriding `name`. Pass the resolved pubkey to keep
   *  the avatar in step with the rail dot; pass null to force a neutral disc
   *  (an identity we cannot verify). Omit to hash the name. */
  identity?: string | null;
  size?: 'sm' | 'md';
  className?: string;
}

const SIZE_PX: Record<NonNullable<Props['size']>, number> = { sm: 24, md: 32 };

export function ContactAvatar({ name, identity, size = 'sm', className }: Props) {
  const hashInput = identity === undefined ? name : identity;
  const color = hashInput === null ? null : getNameColor(hashInput);
  const px = SIZE_PX[size];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium',
        color === null && 'bg-cs-bg-3 text-cs-text-dim',
        className,
      )}
      style={{
        width: px,
        height: px,
        backgroundColor: color?.bg,
        color: color?.fg,
        fontSize: size === 'sm' ? 10 : 12,
      }}
    >
      {initialsFor(name)}
    </div>
  );
}
```

- [ ] **Step 6: Wire the transcript avatar to the same identity**

In `src/renderer/components/MessageItem.tsx`, find the `<ContactAvatar …>` render (~line 110) and pass the resolved identity so the avatar and the author name agree:

```tsx
  const avatarIdentity = useIdentityHash(message.fromPublicKeyHex, senderName);
```

then `<ContactAvatar name={senderName} identity={avatarIdentity} … />`. Import `useIdentityHash` from `../hooks/useIdentityHash`. Use whatever the file already calls the derived sender name — do not introduce a second derivation.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --project dom && npx tsc --noEmit`
Expected: PASS. `message-item-quick-bar.test.tsx` renders against an empty default store, so its identities are now neutral — that is expected and it should still pass, because it asserts on the quick bar, not on colour. If it asserts colour, seed `useStore.setState({ contacts: [...] })` in that test rather than weakening this change.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/ColoredUsername.tsx src/renderer/components/ContactAvatar.tsx src/renderer/components/MessageItem.tsx src/renderer/hooks/useIdentityHash.ts tests/component/colored-username.test.tsx
git commit -m "feat(identity): honour the identity colour mode in names and avatars

Transcript author names and avatars now hash the same input the rail dot
will, so the two views agree on what colour a person is. Under byKey an
unverifiable poster renders neutral instead of borrowing a colour from
their display name."
```

---

### Task 5: `SetPathEditor` hop identities

**Files:**
- Modify: `src/renderer/components/path/SetPathEditor.tsx:221` and `:319`

**Interfaces:**
- Consumes: `ContactAvatar`'s `identity` prop (Task 4).
- Produces: nothing.

- [ ] **Step 1: Read both call sites**

Run: `npx biome check src/renderer/components/path/SetPathEditor.tsx` then open lines 210-230 and 310-330. Line 319 currently renders `<ContactAvatar name={knownName ?? hop.prefixHex} />` — under the old "hash a name" premise it was hashing a 2/4/8-character **hex prefix**, which is why unknown hops got arbitrary colours.

- [ ] **Step 2: Pass explicit identities**

At line 221 (the repeater picker), pass the repeater's `publicKeyHex` as `identity` so it matches the rail and transcript:

```tsx
<ContactAvatar name={r.name} identity={r.publicKeyHex} size="sm" />
```

At line 319 (the hop row), a known repeater uses its key; an unknown hop's `prefixHex` **is** key material, so it is a legitimate hash input under `byKey` — but under `byName` there is no name, so it must go neutral:

```tsx
const mode = useStore((s) => s.appSettings.identityColorMode ?? 'byKey');
// …
<ContactAvatar
  name={knownName ?? hop.prefixHex}
  identity={knownPublicKeyHex ?? (mode === 'byKey' ? hop.prefixHex : null)}
  size="sm"
/>
```

Adapt the variable names to whatever the file already uses for the resolved repeater — do not rename existing locals.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run && npx biome check src tests`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/path/SetPathEditor.tsx
git commit -m "fix(path): stop hashing hex prefixes as if they were names

An unknown hop's avatar hashed its 2/4/8-char prefix under a hash-the-name
premise, giving it a colour unrelated to any identity. Known repeaters now
hash their pubkey; unknown hops hash the prefix only under byKey, where
key material is the point, and render neutral under byName."
```

---

### Task 6: The pure People model

**Files:**
- Create: `src/renderer/shell/rightrail/sections/peopleModel.ts`
- Modify: `src/shared/types.ts` (the three People types — they are declared here, not in the renderer, because `UiState.peopleRail` in Task 8 needs them and `shared/` must never import from `renderer/`)
- Test: `tests/unit/renderer/shell/peopleModel.test.ts`

**Interfaces:**
- Consumes: `resolveIdentity`, `ResolvedIdentity` (Task 2); `ChannelSenderStat` from `src/shared/types`.
- Produces, in `src/shared/types.ts`:
  ```ts
  type PeopleSort = 'recent' | 'loud' | 'name';
  type PeopleFilter = 'all' | 'contacts';
  interface PeopleRailPrefs { sort: PeopleSort; filter: PeopleFilter }
  ```
- Produces, in `peopleModel.ts`:
  ```ts
  type BucketId = 'today' | 'yesterday' | 'week' | 'earlier';
  interface RosterRow {
    id: string; name: string; pubkey: string | null; contactKey: string | null;
    source: IdentitySource; ambiguous: boolean; blocked: boolean;
    inContacts: boolean; msgCount: number; lastSeenAt: number;
  }
  interface Bucket { id: BucketId; label: string; rows: RosterRow[] }
  toRosterRows(roster, contacts, discovered): RosterRow[]
  fmtAge(ts: number, now: number): string
  fmtCount(n: number): string
  bucketFor(ts: number, now: number): BucketId
  sortRoster(rows: RosterRow[], sort: PeopleSort): RosterRow[]
  filterRoster(rows: RosterRow[], filter: PeopleFilter, query: string): RosterRow[]
  groupByBucket(rows: RosterRow[], now: number): Bucket[]
  maxCount(rows: RosterRow[]): number
  volumeWidth(count: number, max: number): string
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/renderer/shell/peopleModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  filterRoster,
  fmtAge,
  fmtCount,
  groupByBucket,
  maxCount,
  sortRoster,
  toRosterRows,
  volumeWidth,
} from '../../../../src/renderer/shell/rightrail/sections/peopleModel';
import type { RosterRow } from '../../../../src/renderer/shell/rightrail/sections/peopleModel';

const NOW = new Date('2026-07-25T14:30:00').getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  id: 'name:alice',
  name: 'alice',
  pubkey: 'abc',
  contactKey: 'c:abc',
  source: 'contact',
  ambiguous: false,
  blocked: false,
  inContacts: true,
  msgCount: 1,
  lastSeenAt: NOW,
  ...over,
});

describe('fmtAge', () => {
  it('renders an em dash for a missing or impossible timestamp', () => {
    expect(fmtAge(0, NOW)).toBe('—');
    expect(fmtAge(-1, NOW)).toBe('—');
    expect(fmtAge(Number.NaN, NOW)).toBe('—');
  });

  it('clamps a future timestamp to now rather than showing a negative age', () => {
    expect(fmtAge(NOW + HOUR, NOW)).toBe('now');
  });

  it('walks the compact ladder', () => {
    expect(fmtAge(NOW - 30_000, NOW)).toBe('now');
    expect(fmtAge(NOW - 59_999, NOW)).toBe('now');
    expect(fmtAge(NOW - 12 * MIN, NOW)).toBe('12m');
    expect(fmtAge(NOW - 59 * MIN, NOW)).toBe('59m');
    expect(fmtAge(NOW - 3 * HOUR, NOW)).toBe('3h');
    expect(fmtAge(NOW - 2 * DAY, NOW)).toBe('2d');
    expect(fmtAge(NOW - 6 * DAY, NOW)).toBe('6d');
    expect(fmtAge(NOW - 21 * DAY, NOW)).toBe('3w');
  });

  it('never renders 24h — the sub-day rung caps at 23h', () => {
    expect(fmtAge(NOW - 1439 * MIN, NOW)).toBe('23h');
  });

  it('rounds hours but floors days and weeks', () => {
    expect(fmtAge(NOW - 100 * MIN, NOW)).toBe('2h'); // 1.67 rounds up
    expect(fmtAge(NOW - (2 * DAY + 23 * HOUR), NOW)).toBe('2d'); // floors
  });
});

describe('fmtCount', () => {
  it('never exceeds three characters', () => {
    for (const n of [0, 7, 999, 1000, 12_345, 99_999, 1_000_000]) {
      expect(fmtCount(n).length).toBeLessThanOrEqual(3);
    }
  });

  it('prints small counts literally and abbreviates thousands', () => {
    expect(fmtCount(0)).toBe('0');
    expect(fmtCount(999)).toBe('999');
    expect(fmtCount(1000)).toBe('1k');
    expect(fmtCount(12_345)).toBe('12k');
    expect(fmtCount(99_999)).toBe('99k');
  });

  it('clamps runaway counts at 99k', () => {
    expect(fmtCount(1_000_000)).toBe('99k');
  });
});

describe('bucketFor', () => {
  it('is calendar-relative, not rolling', () => {
    expect(bucketFor(new Date('2026-07-25T00:05:00').getTime(), NOW)).toBe('today');
    expect(bucketFor(new Date('2026-07-24T23:55:00').getTime(), NOW)).toBe('yesterday');
    expect(bucketFor(new Date('2026-07-23T12:00:00').getTime(), NOW)).toBe('week');
    expect(bucketFor(new Date('2026-07-18T12:00:00').getTime(), NOW)).toBe('week');
    expect(bucketFor(new Date('2026-07-17T12:00:00').getTime(), NOW)).toBe('earlier');
  });

  it('crosses a month boundary correctly', () => {
    const aug1 = new Date('2026-08-01T09:00:00').getTime();
    expect(bucketFor(new Date('2026-07-31T22:00:00').getTime(), aug1)).toBe('yesterday');
    expect(bucketFor(new Date('2026-07-30T22:00:00').getTime(), aug1)).toBe('week');
  });
});

describe('sortRoster', () => {
  const rows = [
    row({ id: 'a', name: 'carol', msgCount: 5, lastSeenAt: NOW - HOUR }),
    row({ id: 'b', name: 'alice', msgCount: 9, lastSeenAt: NOW - 3 * HOUR }),
    row({ id: 'c', name: 'bob', msgCount: 5, lastSeenAt: NOW - 2 * HOUR }),
  ];

  it('recent sorts by last seen, newest first', () => {
    expect(sortRoster(rows, 'recent').map((r) => r.name)).toEqual(['carol', 'bob', 'alice']);
  });

  it('loud sorts by count, breaking ties on recency then name', () => {
    expect(sortRoster(rows, 'loud').map((r) => r.name)).toEqual(['alice', 'carol', 'bob']);
  });

  it('name sorts case-insensitively', () => {
    expect(sortRoster(rows, 'name').map((r) => r.name)).toEqual(['alice', 'bob', 'carol']);
  });

  it('name ignores leading emoji and punctuation', () => {
    const decorated = [row({ id: 'x', name: '🚀 zeta' }), row({ id: 'y', name: '!alpha' }), row({ id: 'z', name: 'mid' })];
    expect(sortRoster(decorated, 'name').map((r) => r.name)).toEqual(['!alpha', 'mid', '🚀 zeta']);
  });

  it('does not mutate its input', () => {
    const input = [...rows];
    sortRoster(input, 'name');
    expect(input.map((r) => r.name)).toEqual(['carol', 'alice', 'bob']);
  });
});

describe('filterRoster', () => {
  const rows = [row({ id: 'a', name: 'Alice', inContacts: true }), row({ id: 'b', name: 'bob', inContacts: false })];

  it('all with an empty query is a passthrough', () => {
    expect(filterRoster(rows, 'all', '')).toHaveLength(2);
  });

  it('contacts keeps only saved people', () => {
    expect(filterRoster(rows, 'contacts', '').map((r) => r.name)).toEqual(['Alice']);
  });

  it('searches case-insensitively on a substring', () => {
    expect(filterRoster(rows, 'all', 'LIC').map((r) => r.name)).toEqual(['Alice']);
  });

  it('composes filter and query', () => {
    expect(filterRoster(rows, 'contacts', 'bob')).toHaveLength(0);
  });
});

describe('groupByBucket', () => {
  it('omits empty buckets and keeps row order inside each', () => {
    const rows = [
      row({ id: 'a', lastSeenAt: NOW - HOUR }),
      row({ id: 'b', lastSeenAt: NOW - 30 * DAY }),
      row({ id: 'c', lastSeenAt: NOW - 2 * HOUR }),
    ];
    const buckets = groupByBucket(rows, NOW);
    expect(buckets.map((b) => b.id)).toEqual(['today', 'earlier']);
    expect(buckets[0].rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns nothing for an empty roster', () => {
    expect(groupByBucket([], NOW)).toEqual([]);
  });
});

describe('volume bar', () => {
  it('scales against the loudest row in the set', () => {
    expect(maxCount([row({ msgCount: 4 }), row({ msgCount: 10 })])).toBe(10);
    expect(volumeWidth(5, 10)).toBe('50%');
  });

  it('floors at 6% so a quiet row still shows a mark', () => {
    expect(volumeWidth(1, 1000)).toBe('6%');
  });

  it('renders a bare track when there is nothing to scale against', () => {
    expect(maxCount([])).toBe(0);
    expect(volumeWidth(0, 0)).toBe('0%');
  });
});

describe('toRosterRows', () => {
  it('drops self and unknown', () => {
    const rows = toRosterRows(
      [
        { fromPk: null, count: 1, lastTs: NOW },
        { fromPk: 'unknown', count: 2, lastTs: NOW },
        { fromPk: 'name:alice', count: 3, lastTs: NOW },
      ],
      [],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(['alice']);
  });

  it('marks a saved poster as a contact', () => {
    const contacts = [{ key: 'c:abc', publicKeyHex: 'abc', name: 'alice', kind: 'chat' as const }];
    const [r] = toRosterRows([{ fromPk: 'name:alice', count: 3, lastTs: NOW }], contacts, []);
    expect(r).toMatchObject({ inContacts: true, contactKey: 'c:abc', pubkey: 'abc', msgCount: 3, lastSeenAt: NOW });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project unit tests/unit/renderer/shell/peopleModel.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`, near the other rail-facing types:

```ts
export type PeopleSort = 'recent' | 'loud' | 'name';
export type PeopleFilter = 'all' | 'contacts';

/** Per-channel People rail view state. Persisted in UiState (Task 8). */
export interface PeopleRailPrefs {
  sort: PeopleSort;
  filter: PeopleFilter;
}
```

- [ ] **Step 4: Create `peopleModel.ts`**

```ts
// Pure model for the channel People rail. No React, no store, no DOM — every
// decision the section makes lives here so it can be tested at the boundaries.
//
// Keep this module store-free: its tests run in the `unit` project under
// environment: 'node'.

import type { DiscoveredContact } from '../../../../shared/contacts/discovered';
import type { ChannelSenderStat, Contact, PeopleFilter, PeopleSort } from '../../../../shared/types';
import { type IdentitySource, buildDiscoveredNameIndex, resolveIdentity } from '../../../lib/identity';

export type { PeopleFilter, PeopleSort };
export type BucketId = 'today' | 'yesterday' | 'week' | 'earlier';

export interface RosterRow {
  /** The raw from_pk. Unique — it is a GROUP BY key. */
  id: string;
  name: string;
  pubkey: string | null;
  contactKey: string | null;
  source: IdentitySource;
  ambiguous: boolean;
  blocked: boolean;
  inContacts: boolean;
  /** Messages seen in THIS channel, not globally. */
  msgCount: number;
  lastSeenAt: number;
}

export interface Bucket {
  id: BucketId;
  label: string;
  rows: RosterRow[];
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const BUCKET_LABELS: Record<BucketId, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
};

const BUCKET_ORDER: BucketId[] = ['today', 'yesterday', 'week', 'earlier'];

/** Map the raw roster to rows, dropping self (`null`) and the `'unknown'`
 *  aggregate — neither has a name to search or sort, a key, or an action, and
 *  `distinctSenders` already excludes both. */
export function toRosterRows(
  roster: ChannelSenderStat[],
  contacts: Contact[],
  discovered: DiscoveredContact[],
): RosterRow[] {
  const index = buildDiscoveredNameIndex(discovered);
  const rows: RosterRow[] = [];
  for (const entry of roster) {
    if (!entry.fromPk || entry.fromPk === 'unknown') continue;
    const id = resolveIdentity(entry.fromPk, contacts, index);
    if (id.name === null) continue;
    rows.push({
      id: entry.fromPk,
      name: id.name,
      pubkey: id.pubkey,
      contactKey: id.contactKey,
      source: id.source,
      ambiguous: id.ambiguous,
      blocked: id.blocked,
      inContacts: id.source === 'contact',
      msgCount: entry.count,
      lastSeenAt: entry.lastTs,
    });
  }
  return rows;
}

/** Compact age: now · 12m · 3h · 2d · 3w. Never prints "ago", "hours" or
 *  "days" — that is what the tooltip is for. */
export function fmtAge(ts: number, now: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—';
  // Node RTCs are unreliable and can report the future; clamp rather than
  // rendering a negative age.
  const elapsed = Math.max(0, now - ts);
  if (elapsed < MIN) return 'now';
  const mins = Math.floor(elapsed / MIN);
  if (mins < 60) return `${mins}m`;
  if (elapsed < DAY) {
    // Math.round(1439/60) is 24, which belongs to the next rung — clamp.
    return `${Math.min(23, Math.round(mins / 60))}h`;
  }
  const days = Math.floor(elapsed / DAY);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** At most three characters — SF Mono is 0.618em/char, so a fourth overflows
 *  the 26px count track at 11px. */
export function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  return `${Math.min(99, Math.floor(n / 1000))}k`;
}

function localMidnight(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Calendar-relative, not rolling. Math.round (not floor) so 23- and 25-hour
 *  DST days still land on whole day counts. */
export function bucketFor(ts: number, now: number): BucketId {
  const days = Math.round((localMidnight(now) - localMidnight(ts)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 7) return 'week';
  return 'earlier';
}

/** Sort key with leading non-alphanumerics stripped, so an emoji or punctuation
 *  prefix sorts by the first real character. */
function nameSortKey(name: string): string {
  return name.replace(/^[^\p{L}\p{N}]+/u, '') || name;
}

export function sortRoster(rows: RosterRow[], sort: PeopleSort): RosterRow[] {
  const out = [...rows];
  switch (sort) {
    case 'recent':
      out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      break;
    case 'loud':
      out.sort(
        (a, b) =>
          b.msgCount - a.msgCount ||
          b.lastSeenAt - a.lastSeenAt ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      break;
    case 'name':
      out.sort((a, b) => nameSortKey(a.name).localeCompare(nameSortKey(b.name), undefined, { sensitivity: 'base' }));
      break;
  }
  return out;
}

export function filterRoster(rows: RosterRow[], filter: PeopleFilter, query: string): RosterRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'contacts' && !r.inContacts) return false;
    if (q && !r.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Buckets in fixed order, empty ones omitted. Row order within a bucket is
 *  preserved, so the caller's sort survives. */
export function groupByBucket(rows: RosterRow[], now: number): Bucket[] {
  const byId = new Map<BucketId, RosterRow[]>();
  for (const r of rows) {
    const id = bucketFor(r.lastSeenAt, now);
    const bucket = byId.get(id);
    if (bucket) bucket.push(r);
    else byId.set(id, [r]);
  }
  return BUCKET_ORDER.filter((id) => byId.has(id)).map((id) => ({
    id,
    label: BUCKET_LABELS[id],
    rows: byId.get(id) as RosterRow[],
  }));
}

/** Loudest row in the CURRENT set, so bars answer "who's loud here" and
 *  re-normalise when a filter or search changes the set. */
export function maxCount(rows: RosterRow[]): number {
  let max = 0;
  for (const r of rows) if (r.msgCount > max) max = r.msgCount;
  return max;
}

export function volumeWidth(count: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.max(6, (count / max) * 100)}%`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --project unit tests/unit/renderer/shell/peopleModel.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/shell/rightrail/sections/peopleModel.ts tests/unit/renderer/shell/peopleModel.test.ts
git commit -m "feat(people): pure model for the channel roster

Roster mapping, the compact age ladder, three-character count
abbreviation, calendar-relative recency buckets, sort and filter — all
pure, so the boundaries that actually bite (the 24h rung, month and DST
edges, epoch and future timestamps) are tested without a DOM."
```

---

### Task 7: Shared clock

**Files:**
- Create: `src/renderer/hooks/useNowTick.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useNowTick(intervalMs?: number): number` — a `Date.now()` value refreshed on one interval.

- [ ] **Step 1: Create the hook**

```ts
import { useEffect, useState } from 'react';

/** One clock for a whole list.
 *
 *  RelativeTime mounts an interval AND a store subscription per instance, which
 *  is fine for a handful of timestamps and pathological for a 156-row roster.
 *  Sections that render many ages call this once and pass `now` down as a prop.
 *
 *  The default 30s cadence is half the shortest ladder rung (1 minute), so an
 *  age is never more than one tick stale. */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/useNowTick.ts
git commit -m "feat(hooks): add useNowTick for list-level relative time

One interval per list instead of one per row."
```

---

### Task 8: Store and defaults

**Files:**
- Modify: `src/shared/types.ts` (`UiState` ~line 773-824; `DEFAULT_UI_STATE` ~line 826+)
- Modify: `src/renderer/lib/store.ts` (state ~line 237-260; actions interface ~line 415; defaults ~line 537; setters ~line 875)

**Interfaces:**
- Consumes: `PeopleSort`, `PeopleFilter` (Task 6).
- Produces: `store.peopleQuery: string`, `store.setPeopleQuery(q: string): void`, `store.ui.peopleRail: Record<string, PeopleRailPrefs>`, `store.setPeopleRail(channelKey: string, prefs: Partial<PeopleRailPrefs>): void`, where `PeopleRailPrefs = { sort: PeopleSort; filter: PeopleFilter }`.

- [ ] **Step 1: Extend `UiState`**

`PeopleSort`, `PeopleFilter` and `PeopleRailPrefs` already exist in `src/shared/types.ts` from Task 6 Step 3. This task only adds the `UiState` field that uses them.

Add to `UiState`:

```ts
  // Per-channel People rail sort + filter. Keyed by channel key. Grows
  // unboundedly, exactly like lastReadByKey. NOT in applyUiState's sync
  // whitelist, so this persists locally but does not cross-sync.
  peopleRail: Record<string, PeopleRailPrefs>;
```

Add to `DEFAULT_UI_STATE`:

```ts
  peopleRail: {},
```

And change `rightWidth: 320,` to:

```ts
  // 340 is the width the People rail's control bar was designed at. Existing
  // profiles keep whatever they stored — mergeDefaults does not overwrite.
  rightWidth: 340,
```

- [ ] **Step 2: Add store state, actions and setters**

Add to the state interface near `discovered` (~line 237):

```ts
  /** People rail search box. Deliberately at the store ROOT, not under `ui` —
   *  App.tsx persists `ui` and a search query should never survive a relaunch. */
  peopleQuery: string;
```

Add to the actions interface near `setRightWidth` (~line 415):

```ts
  setPeopleQuery: (q: string) => void;
  setPeopleRail: (channelKey: string, prefs: Partial<PeopleRailPrefs>) => void;
```

Add to the initial state near `discovered: []` (~line 537):

```ts
  peopleQuery: '',
```

Add the setters near `setRightWidth` (~line 875):

```ts
  setPeopleQuery: (q) => set(() => ({ peopleQuery: q })),
  setPeopleRail: (channelKey, prefs) =>
    set((s) => ({
      ui: {
        ...s.ui,
        peopleRail: {
          ...s.ui.peopleRail,
          [channelKey]: { sort: 'recent', filter: 'all', ...s.ui.peopleRail[channelKey], ...prefs },
        },
      },
    })),
```

- [ ] **Step 3: Guard the hydration path**

`ui.peopleRail` will be absent from any stored `ui-state.json` written before this change. Find where the store merges a hydrated `ui` (search `hydrate` and `mergeDefaults` in `store.ts`) and confirm an absent key falls back to `{}`. If the merge is a shallow spread over `DEFAULT_UI_STATE`, it already does. If not, add `peopleRail: snapshot.ui?.peopleRail ?? {}`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean. If a test snapshots `DEFAULT_UI_STATE`, update the expected `rightWidth` to 340.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/renderer/lib/store.ts
git commit -m "feat(store): per-channel People rail prefs and a non-persisted query

Sort and filter persist per channel so switching channels doesn't reset
them; the search query lives at the store root, outside the persisted
`ui` object, so it can never survive a relaunch. Default rail width moves
to 340, the width the control bar was designed at."
```

---

### Task 9: The row

**Files:**
- Create: `src/renderer/shell/rightrail/sections/PeopleRow.tsx`

**Interfaces:**
- Consumes: `RosterRow`, `fmtAge`, `fmtCount`, `volumeWidth` (Task 6); `identitySlotFor` (Task 1).
- Produces:
  ```tsx
  interface PeopleRowProps {
    row: RosterRow; now: number; maxCount: number; showVolume: boolean;
    timeFormat: TimeFormatPref;
    onOpen(row: RosterRow): void;
    onMessage(row: RosterRow): void;
    onAddContact(row: RosterRow): void;
  }
  export function PeopleRow(props: PeopleRowProps): JSX.Element
  export function fmtAgeAbsolute(ts: number, now: number, pref: TimeFormatPref): string
  ```
  Also adds `identityDotVar(id: string): string` to `src/renderer/lib/contactColor.ts`.

- [ ] **Step 1: Add the dot accessor to `contactColor.ts`**

The dot uses a different var family from the text (`--cs-id-N` vs `--cs-id-fg-N`), so it needs its own accessor. Append to `src/renderer/lib/contactColor.ts`:

```ts
/** The 7px identity dot's colour. A different, more saturated ramp than the
 *  text one — the dot is a graphical object at a 3:1 bar, text is at 4.5:1. */
export function identityDotVar(id: string): string {
  return `rgb(var(--cs-id-${identitySlotFor(id)}))`;
}

/** A keyless identity: a mark without a hue. */
export const IDENTITY_NEUTRAL_VAR = 'rgb(var(--cs-id-neutral))';
```

- [ ] **Step 2: Create the component**

```tsx
import { MessageSquare, UserPlus } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IDENTITY_NEUTRAL_VAR, identityDotVar } from '../../../lib/contactColor';
import { useStore } from '../../../lib/store';
import { fmtDateTime, fmtTime, fmtTimePrecise } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import type { TimeFormatPref } from '../../../../shared/types';
import { type RosterRow, fmtAge, fmtCount, volumeWidth } from './peopleModel';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The absolute timestamp behind the compact age, one rung per ladder step. */
export function fmtAgeAbsolute(ts: number, now: number, pref: TimeFormatPref): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'Never';
  const elapsed = Math.max(0, now - ts);
  if (elapsed < MIN) return fmtTimePrecise(ts, pref);
  if (elapsed < DAY) return fmtTime(ts, pref);
  if (elapsed < 7 * DAY) return `${new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })} ${fmtTime(ts, pref)}`;
  return fmtDateTime(ts, pref);
}

interface PeopleRowProps {
  row: RosterRow;
  now: number;
  maxCount: number;
  showVolume: boolean;
  timeFormat: TimeFormatPref;
  onOpen: (row: RosterRow) => void;
  onMessage: (row: RosterRow) => void;
  onAddContact: (row: RosterRow) => void;
}

export function PeopleRow({
  row,
  now,
  maxCount,
  showVolume,
  timeFormat,
  onOpen,
  onMessage,
  onAddContact,
}: PeopleRowProps) {
  const mode = useStore((s) => s.appSettings.identityColorMode ?? 'byKey');
  const hashInput = mode === 'byName' ? row.name : row.pubkey;
  const hue = hashInput === null ? IDENTITY_NEUTRAL_VAR : identityDotVar(hashInput);

  // The name tooltip exists only to recover a name the column clipped. Showing
  // it on every row would fire a tooltip on the whole list.
  const nameRef = useRef<HTMLButtonElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = nameRef.current;
    if (el) setClipped(el.scrollWidth > el.clientWidth);
  }, []);

  // Three tiers, and they map 1:1 onto what the row can do:
  //   filled + hued  saved contact          -> message
  //   hollow + hued  advert heard, unsaved  -> add to contacts
  //   hollow + grey  name only              -> nothing actionable
  const canMessage = row.contactKey !== null && !row.blocked;
  const canAdd = !row.inContacts && row.pubkey !== null && !row.blocked;

  const messageHint = row.blocked
    ? 'Blocked'
    : row.contactKey
      ? `Message ${row.name}`
      : 'Add to contacts to message';
  const addHint = row.blocked
    ? 'Blocked'
    : row.pubkey
      ? `Add ${row.name} to contacts`
      : 'No advert heard from this node yet';

  return (
    <div
      className={cn(
        'group relative grid h-6 items-center gap-2 px-2.5',
        'hover:bg-cs-bg-3 group-has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring',
      )}
      style={{
        gridTemplateColumns: showVolume ? '7px 1fr 30px 26px 30px' : '7px 1fr 26px 30px',
      }}
      onClick={() => onOpen(row)}
    >
      <span
        aria-hidden
        className="size-[7px] justify-self-center rounded-full"
        style={
          row.inContacts
            ? { backgroundColor: hue }
            : { backgroundColor: 'transparent', boxShadow: `inset 0 0 0 1.5px ${hue}` }
        }
      />

      {/* The name is a real button: it carries focus and Enter for the whole
          row, so the row div itself needs no tabIndex and there are no nested
          interactive elements. */}
      <Tooltip delayDuration={400} open={clipped ? undefined : false}>
        <TooltipTrigger asChild>
          <button
            ref={nameRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row);
            }}
            className="truncate bg-transparent text-left text-[12.5px] font-medium text-cs-text outline-none"
          >
            {row.name}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">{row.name}</TooltipContent>
      </Tooltip>

      {showVolume && (
        <span aria-hidden className="h-[3px] rounded-[2px] bg-cs-accent/14">
          <span className="block h-full rounded-[2px] bg-cs-accent/78" style={{ width: volumeWidth(row.msgCount, maxCount) }} />
        </span>
      )}

      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <span className="text-right font-mono text-[11px] tabular-nums text-cs-text-muted">{fmtCount(row.msgCount)}</span>
        </TooltipTrigger>
        <TooltipContent side="left">{`${row.msgCount} messages seen in this channel`}</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <span className="whitespace-nowrap text-right font-mono text-[10.5px] tabular-nums text-cs-text-dim">
            {fmtAge(row.lastSeenAt, now)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{fmtAgeAbsolute(row.lastSeenAt, now, timeFormat)}</TooltipContent>
      </Tooltip>

      <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center gap-0.5 bg-gradient-to-r from-transparent to-cs-bg-3 to-34% pl-6 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 motion-reduce:transition-none">
        <RowAction
          icon={<MessageSquare size={12} />}
          label={messageHint}
          disabled={!canMessage}
          onClick={() => onMessage(row)}
        />
        {!row.inContacts && (
          <RowAction icon={<UserPlus size={12} />} label={addHint} disabled={!canAdd} onClick={() => onAddContact(row)} />
        )}
      </span>
    </div>
  );
}

function RowAction({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        {/* A disabled button emits no pointer events, so the tooltip would never
            fire on exactly the rows whose explanation matters most. Keep it
            enabled and inert instead. */}
        <Button
          size="icon"
          variant="ghost"
          aria-disabled={disabled}
          className={cn('size-5 rounded-[5px] hover:bg-cs-bg-3 hover:text-cs-text', disabled && 'opacity-40')}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onClick();
          }}
        >
          {icon}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}
```

One thing to watch: **`to-34%` may not be a valid Tailwind v4 gradient stop in this setup.** If the build or Biome complains, drop the three gradient classes and use an inline style instead:
```tsx
style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgb(var(--cs-bg-3)) 34%)' }}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npx biome check src/renderer/shell/rightrail/sections/PeopleRow.tsx`
Expected: clean.

Biome's a11y rules will likely object to `onClick` on a non-interactive `div`. The row genuinely is not interactive — the name button inside it carries focus, Enter and the accessible name; the div's `onClick` only widens the mouse target to the full row. If Biome flags it, silence that one rule with an inline `biome-ignore` comment explaining exactly that. Do **not** "fix" it by adding `role="button"` and `tabIndex={0}` to the div — that would nest a button inside a button and put two things in the tab order for one row.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/shell/rightrail/sections/PeopleRow.tsx src/renderer/lib/contactColor.ts
git commit -m "feat(people): the 24px roster row

Dot, name, volume bar, count and age on a fixed grid, with the two hover
actions revealed on hover or focus-within. The dot's hue and fill encode
the three actionability tiers, so the retired UserX badge costs no
information: a grey hollow dot is a person we have never heard an advert
from, in a fixed column rather than floating after the name."
```

---

### Task 10: The controls

**Files:**
- Create: `src/renderer/shell/rightrail/sections/PeopleControls.tsx`

**Interfaces:**
- Consumes: `PeopleSort`, `PeopleFilter` (Task 8).
- Produces:
  ```tsx
  interface PeopleControlsProps {
    query: string; sort: PeopleSort; filter: PeopleFilter; showToggles: boolean;
    onQuery(q: string): void; onSort(s: PeopleSort): void; onFilter(f: PeopleFilter): void;
  }
  export function PeopleControls(props: PeopleControlsProps): JSX.Element
  export const PEOPLE_WIDTH_THRESHOLD = 310;
  ```

- [ ] **Step 1: Create the component**

```tsx
import { Search } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { PeopleFilter, PeopleSort } from '../../../../shared/types';
import { cn } from '../../../lib/utils';

/** Below this rail width the control row is dropped and the volume bar is
 *  omitted; search stands alone. Lowered from the handoff's 330 so an existing
 *  320px rail is not stranded in the degraded mode. */
export const PEOPLE_WIDTH_THRESHOLD = 310;

const SORTS: ReadonlyArray<{ value: PeopleSort; label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'loud', label: 'Loudest' },
  { value: 'name', label: 'A–Z' },
];

const FILTERS: ReadonlyArray<{ value: PeopleFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'contacts', label: 'Contacts' },
];

// ToggleGroupItem ships as a segmented bar: flex-1 (equal widths), rounded-none
// with first/last corner rounding, and data-[state=on]:bg-accent — which is
// cs-bg-3 on a cs-bg-2 rail, about 1.05:1 and effectively invisible. The design
// inverts that: an intrinsic-width pill, individually rounded, and the SELECTED
// item goes darker with an amber label.
const ITEM = cn(
  'h-[22px] min-w-0 flex-none rounded-[5px] px-[7px] py-[3px] font-mono text-[9.5px] font-medium',
  'first:rounded-[5px] last:rounded-[5px]',
  'text-cs-text-muted hover:bg-transparent hover:text-cs-text',
  'data-[state=on]:bg-cs-bg data-[state=on]:text-cs-accent data-[state=on]:shadow-[0_1px_0_rgba(0,0,0,.3)]',
);

const GROUP = 'gap-0.5 rounded-[7px] border border-cs-border bg-cs-bg-3 p-0.5';

interface PeopleControlsProps {
  query: string;
  sort: PeopleSort;
  filter: PeopleFilter;
  /** False below PEOPLE_WIDTH_THRESHOLD — search stands alone. */
  showToggles: boolean;
  onQuery: (q: string) => void;
  onSort: (s: PeopleSort) => void;
  onFilter: (f: PeopleFilter) => void;
}

export function PeopleControls({
  query,
  sort,
  filter,
  showToggles,
  onQuery,
  onSort,
  onFilter,
}: PeopleControlsProps) {
  return (
    <>
      <div className="mx-2.5 mb-2 flex h-[26px] items-center gap-[7px] rounded-[7px] border border-cs-border bg-cs-bg-2 px-2">
        <Search size={11} aria-hidden className="shrink-0 text-cs-text-dim" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-cs-text outline-none placeholder:text-cs-text-dim"
        />
      </div>

      {showToggles && (
        <div className="mx-2.5 mb-1.5 flex items-center gap-1.5">
          <ToggleGroup
            type="single"
            value={sort}
            onValueChange={(v) => v && onSort(v as PeopleSort)}
            aria-label="Sort people"
            className={GROUP}
          >
            {SORTS.map((s) => (
              <ToggleGroupItem key={s.value} value={s.value} className={ITEM}>
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => v && onFilter(v as PeopleFilter)}
            aria-label="Filter people"
            className={cn(GROUP, 'ml-auto')}
          >
            {FILTERS.map((f) => (
              <ToggleGroupItem key={f.value} value={f.value} className={ITEM}>
                {f.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
    </>
  );
}
```

Radix's single-type ToggleGroup emits `''` when the active item is clicked again — the `v &&` guard keeps a sort always selected.

The search field is a bare `<input>` rather than the shadcn `Input`: `Input` ships `h-9`, `rounded-md`, `border-input`, `shadow-xs`, `px-3` and `md:text-sm`, every one of which this design overrides. Fighting six classes to reuse a wrapper that adds nothing is worse than the twelve-class input above. The leading icon needs a flex container regardless.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx biome check src/renderer/shell/rightrail/sections/PeopleControls.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/shell/rightrail/sections/PeopleControls.tsx
git commit -m "feat(people): search, sort and filter controls

Two ToggleGroups with the selected item inverted to a darker pill with an
amber label — the stock data-[state=on]:bg-accent is cs-bg-3 on a cs-bg-2
rail, about 1.05:1 and invisible. Controls collapse to the search field
alone below a 310px rail."
```

---

### Task 11: Compose the section

**Files:**
- Modify: `src/renderer/shell/rightrail/sections/ChannelPeople.tsx` (rewrite)
- Modify: `src/renderer/shell/rightrail/sectionsFor.tsx:27-32` and the People entry ~line 199-204
- Modify: `src/renderer/shell/rightrail/index.tsx:118-133`
- Test: `tests/component/channel-people-section.test.tsx` (rewrite)

**Interfaces:**
- Consumes: everything from Tasks 1-10.
- Produces: `ChannelPeopleBody` (exported for tests) and `ChannelPeopleSection`. `contactKeyForSender` is **deleted** — its tests moved to `identity.test.ts` in Task 2.

- [ ] **Step 1: Rewrite the failing test**

Replace `tests/component/channel-people-section.test.tsx` entirely:

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelPeopleBody } from '@/shell/rightrail/sections/ChannelPeople';
import { useStore } from '@/lib/store';
import type { ChannelStats, Contact } from '../../src/shared/types';

const NOW = Date.now();

const contact = (over: Partial<Contact> = {}): Contact => ({
  key: 'c:abc',
  publicKeyHex: 'abc',
  name: 'alice',
  kind: 'chat',
  ...over,
});

const stats = (): ChannelStats => ({
  count: 6,
  firstTs: 1,
  lastTs: NOW,
  count24h: 0,
  count7d: 6,
  distinctSenders: 2,
  roster: [
    { fromPk: null, count: 1, lastTs: NOW }, // self — excluded
    { fromPk: 'unknown', count: 2, lastTs: NOW }, // aggregate — excluded
    { fromPk: 'name:alice', count: 3, lastTs: NOW - 3 * 3_600_000 },
    { fromPk: 'name:zora', count: 7, lastTs: NOW - 2 * 86_400_000 },
  ],
  perDay: [0, 0, 0, 0, 0, 0, 0],
});

beforeEach(() => {
  useStore.setState({ contacts: [contact()], discovered: [], peopleQuery: '' });
});

const body = (over: Partial<ComponentProps<typeof ChannelPeopleBody>> = {}) => (
  <ChannelPeopleBody
    stats={stats()}
    loading={false}
    railWidth={340}
    sort="recent"
    filter="all"
    query=""
    onQuery={() => {}}
    onSort={() => {}}
    onFilter={() => {}}
    onOpenContact={() => {}}
    {...over}
  />
);

describe('ChannelPeopleBody', () => {
  it('drops self and the unknown aggregate from the roster', () => {
    render(body());
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('zora')).toBeTruthy();
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('renders the compact age ladder, never prose', () => {
    render(body());
    expect(screen.getByText('3h')).toBeTruthy();
    expect(screen.getByText('2d')).toBeTruthy();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it('buckets by recency and omits empty buckets', () => {
    render(body());
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.queryByText('Yesterday')).toBeNull();
  });

  it('flattens the buckets when sorting by volume', () => {
    render(body({ sort: 'loud' }));
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('navigates on a row click', () => {
    const onOpenContact = vi.fn();
    render(body({ onOpenContact }));
    fireEvent.click(screen.getByText('alice'));
    expect(onOpenContact).toHaveBeenCalledWith('c:abc');
  });

  it('explains why an unheard poster has no actions', () => {
    render(body());
    const zora = screen.getByText('zora').closest('div') as HTMLElement;
    expect(within(zora).getByText('No advert heard from this node yet')).toBeTruthy();
  });

  it('filters to contacts', () => {
    render(body({ filter: 'contacts' }));
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.queryByText('zora')).toBeNull();
  });

  it('reports no match for a query, echoing it', () => {
    render(body({ query: 'zzz' }));
    expect(screen.getByText(/No one matches/)).toBeTruthy();
    expect(screen.getByText(/zzz/)).toBeTruthy();
  });

  it('hides the controls when nobody has been heard', () => {
    const empty = { ...stats(), roster: [] };
    render(body({ stats: empty }));
    expect(screen.getByText('No one has been heard in this channel yet.')).toBeTruthy();
    expect(screen.queryByLabelText('Search people')).toBeNull();
  });

  it('drops the sort and filter toggles on a narrow rail', () => {
    render(body({ railWidth: 300 }));
    expect(screen.getByLabelText('Search people')).toBeTruthy();
    expect(screen.queryByLabelText('Sort people')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project dom tests/component/channel-people-section.test.tsx`
Expected: FAIL — `ChannelPeopleBody` does not take these props.

- [ ] **Step 3: Rewrite `ChannelPeople.tsx`**

```tsx
import { type ReactNode, useEffect } from 'react';
import type { Channel, ChannelStats, PeopleFilter, PeopleSort } from '../../../../shared/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useChannelStats } from '../../../hooks/useChannelStats';
import { useNowTick } from '../../../hooks/useNowTick';
import type { ApiClient } from '../../../lib/api';
import { useStore } from '../../../lib/store';
import { PEOPLE_WIDTH_THRESHOLD, PeopleControls } from './PeopleControls';
import { PeopleRow } from './PeopleRow';
import { type RosterRow, filterRoster, groupByBucket, maxCount, sortRoster, toRosterRows } from './peopleModel';

interface BodyProps {
  stats: ChannelStats | null;
  loading: boolean;
  railWidth: number;
  sort: PeopleSort;
  filter: PeopleFilter;
  query: string;
  onQuery: (q: string) => void;
  onSort: (s: PeopleSort) => void;
  onFilter: (f: PeopleFilter) => void;
  onOpenContact: (contactKey: string) => void;
  /** Save a poster we have a pubkey for. Only ever called for rows whose
   *  UserPlus is enabled, i.e. `pubkey !== null && !inContacts && !blocked`. */
  onAddContact: (row: RosterRow) => void;
}

export function ChannelPeopleBody({
  stats,
  loading,
  railWidth,
  sort,
  filter,
  query,
  onQuery,
  onSort,
  onFilter,
  onOpenContact,
  onAddContact,
}: BodyProps) {
  const now = useNowTick();
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const timeFormat = useStore((s) => s.appSettings.timeFormat);

  if (loading && !stats) {
    return (
      <div className="flex flex-col gap-1 px-2.5 py-1">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  const all = toRosterRows(stats?.roster ?? [], contacts, discovered);
  if (all.length === 0) {
    return <EmptyNote>No one has been heard in this channel yet.</EmptyNote>;
  }

  const wide = railWidth >= PEOPLE_WIDTH_THRESHOLD;
  const shown = sortRoster(filterRoster(all, filter, query), sort);
  const max = maxCount(shown);
  const showVolume = wide && sort !== 'name';

  const rowProps = {
    now,
    maxCount: max,
    showVolume,
    timeFormat,
    onOpen: (r: RosterRow) => {
      if (r.contactKey) onOpenContact(r.contactKey);
    },
    onMessage: (r: RosterRow) => {
      if (r.contactKey) onOpenContact(r.contactKey);
    },
    onAddContact,
  };

  return (
    <div className="pb-1.5">
      <PeopleControls
        query={query}
        sort={sort}
        filter={filter}
        showToggles={wide}
        onQuery={onQuery}
        onSort={onSort}
        onFilter={onFilter}
      />

      {shown.length === 0 ? (
        query ? (
          <EmptyNote>
            No one matches "<span className="text-cs-text-muted">{query}</span>". Clear the search to see all {all.length}.
          </EmptyNote>
        ) : (
          <EmptyNote>No one matches that filter.</EmptyNote>
        )
      ) : sort === 'recent' ? (
        groupByBucket(shown, now).map((bucket) => (
          <div key={bucket.id}>
            <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-[13px] first:pt-1.5">
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-cs-text-dim">{bucket.label}</span>
              <span className="font-mono text-[9px] text-cs-text-dim opacity-75">{bucket.rows.length}</span>
              <span aria-hidden className="h-px flex-1 bg-cs-border" />
            </div>
            {bucket.rows.map((r) => (
              <PeopleRow key={r.id} row={r} {...rowProps} />
            ))}
          </div>
        ))
      ) : (
        shown.map((r) => <PeopleRow key={r.id} row={r} {...rowProps} />)
      )}
    </div>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-[11.5px] text-cs-text-dim">{children}</p>;
}

/** Header count: `156`, or `«n» / 156` while a query or filter narrows it. */
export function ChannelPeopleCount({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats } = useChannelStats(channel.key, client);
  const contacts = useStore((s) => s.contacts);
  const discovered = useStore((s) => s.discovered);
  const query = useStore((s) => s.peopleQuery);
  const prefs = useStore((s) => s.ui.peopleRail[channel.key]);
  const filter = prefs?.filter ?? 'all';

  const all = toRosterRows(stats?.roster ?? [], contacts, discovered);
  if (all.length === 0) return null;
  const shown = filterRoster(all, filter, query);
  const narrowed = query !== '' || filter !== 'all';

  return (
    <span className="font-mono text-[10px] tabular-nums text-cs-text-dim">
      {narrowed ? `${shown.length} / ${all.length}` : all.length}
    </span>
  );
}

export function ChannelPeopleSection({ channel, client }: { channel: Channel; client: ApiClient | null }) {
  const { stats, loading } = useChannelStats(channel.key, client);
  const railWidth = useStore((s) => s.ui.rightWidth);
  const query = useStore((s) => s.peopleQuery);
  const setQuery = useStore((s) => s.setPeopleQuery);
  const prefs = useStore((s) => s.ui.peopleRail[channel.key]);
  const setPeopleRail = useStore((s) => s.setPeopleRail);
  const setActiveKey = useStore((s) => s.setActiveKey);

  // The rail keys its Collapsible on a constant section id, so this component
  // does NOT remount when the channel changes. Clear the query explicitly.
  useEffect(() => {
    setQuery('');
  }, [channel.key, setQuery]);

  return (
    <ChannelPeopleBody
      stats={stats}
      loading={loading}
      railWidth={railWidth}
      sort={prefs?.sort ?? 'recent'}
      filter={prefs?.filter ?? 'all'}
      query={query}
      onQuery={setQuery}
      onSort={(sort) => setPeopleRail(channel.key, { sort })}
      onFilter={(filter) => setPeopleRail(channel.key, { filter })}
      onOpenContact={setActiveKey}
      onAddContact={addContact}
    />
  );
}
```

`addContact` is wired in the next step.

Note `useChannelStats` is called in both `ChannelPeopleCount` and `ChannelPeopleSection`. That is two fetches per channel. If the duplicate is objectionable, lift the stats into a small context in a follow-up — do **not** restructure the rail for it here.

- [ ] **Step 4: Wire "add to contacts"**

`UserPlus` is only enabled for a row that already has a resolved `pubkey` (from the advert-derived discovered pool) and is not yet saved, so the data needed to save is in hand.

Find the existing affordance rather than inventing one: the Contact Manager already promotes a discovered node to a saved contact. Locate it with

```bash
grep -rn "addToRadio\|putContact" src/renderer --include=*.tsx --include=*.ts
```

Read that call site and reuse the same function and the same post-save behaviour (toast, store update, error handling). Then in `ChannelPeopleSection`:

```tsx
  const client = /* the section's existing client prop */;
  const addContact = useCallback(
    (row: RosterRow) => {
      if (!client || !row.pubkey) return;
      // Same call the Contact Manager uses to promote a discovered node.
      void addDiscoveredContact(client, row.pubkey, row.name);
    },
    [client],
  );
```

Match the real signature you found — do **not** invent parameters. If the existing helper takes a whole `DiscoveredContact`, look the row up in `useStore.getState().discovered` by `publicKeyHex` and pass that.

If no reusable helper exists and the only options are raw `api.*` calls, stop and say so in the task report rather than hand-rolling contact creation here — saving a contact has radio-side consequences and belongs behind whatever the app already does.

- [ ] **Step 5: Plumb `trailing` through the rail**

In `sectionsFor.tsx`, extend the interface (line 27-32):

```tsx
export interface RailSection {
  id: string; // persisted key e.g. 'rail.channel.info'
  label: string;
  body: () => React.ReactNode;
  /** Right-aligned header slot — a count chip, a badge. */
  trailing?: () => React.ReactNode;
  defaultOpen?: boolean;
  /** True for sections whose rows are full-bleed and supply their own padding. */
  bare?: boolean;
}
```

Update the import on line 10 to `import { ChannelPeopleCount, ChannelPeopleSection } from './sections/ChannelPeople';` and the People entry (~line 199-204):

```tsx
            {
              id: 'rail.channel.people',
              label: 'People',
              defaultOpen: false,
              bare: true,
              body: () => <ChannelPeopleSection channel={ch} client={actions.client} />,
              trailing: () => <ChannelPeopleCount channel={ch} client={actions.client} />,
            },
```

In `rightrail/index.tsx`, pass both through (lines 122-130):

```tsx
                <Collapsible
                  key={section.id}
                  label={section.label}
                  open={open}
                  onToggle={() => setRailSection(section.id, !open)}
                  trailing={section.trailing?.()}
                  className="border-b border-cs-border last:border-b-0"
                >
                  <div className={section.bare ? 'text-xs text-cs-text-muted' : 'px-3 py-2 text-xs text-cs-text-muted'}>
                    {section.body()}
                  </div>
                </Collapsible>
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run && npx tsc --noEmit && npx biome check src tests`
Expected: all green. `rail-sections-channel.test.tsx` asserts section id order and `defaultOpen` — it should pass untouched. If it fails, you changed the order; revert that.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/shell/rightrail/sections/ChannelPeople.tsx src/renderer/shell/rightrail/sectionsFor.tsx src/renderer/shell/rightrail/index.tsx tests/component/channel-people-section.test.tsx
git commit -m "feat(people): rebuild the channel roster as a searchable directory

Replaces the flat name+count+'N hours ago' list with the People — Full
layout: recency buckets, search, sort and a contacts filter, a header
count that narrows with the view, and empty states that stay inside the
section. Self and the 'unknown' aggregate are dropped from the roster —
neither has a name, a key, or an action."
```

---

### Task 12: Verify the ramp in the real app

This is the spec's §7.6 gate. All 72 ramp values pass WCAG, but whether 12 hues 30° apart at chroma 0.060 are *tellable apart* cannot be settled from a contrast table.

**Files:** none — this task produces screenshots and either confirms the ramp or produces a one-line chroma change.

- [ ] **Step 1: Full verification sweep**

```bash
npx tsc --noEmit
npx biome check src tests
npx vitest run
```
Expected: all three clean. Do not proceed past a failure.

- [ ] **Step 2: Build and drive the app**

Follow the project's existing Playwright + Electron recipe: `pnpm package`, then launch with `CORESENSE_USER_DATA` pointing at a scratch profile and `FAKE_TRANSPORT` enabled, seeding a channel roster into `messages.db` with at least 12 distinct posters (so every slot is exercised), a mix of saved contacts, advert-only nodes, and never-heard names.

- [ ] **Step 3: Capture the matrix**

Screenshot the People section at rail widths **300** (narrow: search only, no volume bar), **340** (default) and **420** (widened), in **both** themes. Confirm in each shot:

- all three dot tiers are present and distinguishable — filled+hued, hollow+hued, hollow+grey;
- the neutral dot reads as a mark, not a hole, and not louder than the coloured ones;
- hovering a row visibly changes its background (this is the `bg-cs-bg-2`-on-`bg-cs-bg-2` trap from spec §2.2 — if hover is invisible, the fix is the row class, not the rail);
- `999+`-scale counts and every age token fit their tracks without clipping;
- the selected sort/filter pill is obviously selected (the stock `data-[state=on]:bg-accent` is invisible here);
- bucket headers rule out to the full width and no empty bucket renders.

- [ ] **Step 4: Judge the hues**

Look at all 12 slots side by side in both themes.

- If they read clearly: done, no change.
- If dark reads mushy: raise dark chroma only — dark has ~6 points of contrast headroom. Re-run the ramp computation and update the dark values in `index.css` with fresh ratio comments.
- If light reads mushy: **lower `L`, never raise `C`.** Cyan (h=175/205) is gamut-bound below `L≈0.60`; the pre-approved fallback is dot light `oklch(0.52 0.089 h)`, which measures worst 3.93 on `bg-3` with all 12 in gamut.

- [ ] **Step 5: Commit any adjustment**

```bash
git add src/renderer/index.css
git commit -m "style(identity): adjust the light ramp for hue separation

Verified against the real app in both themes; contrast ratios in the
trailing comments recomputed."
```

Skip this commit entirely if step 4 found nothing to change.

---

## Notes for the implementer

- **The spec is the authority.** Where this plan and `docs/superpowers/specs/2026-07-25-people-rail-polish-design.md` disagree, the spec wins — and tell the reviewer, because it means the plan has a bug.
- **Line numbers drift.** Every `file.ts:NNN` here was accurate at `3094fec`. Locate by symbol name, not by line.
- **Two things are deliberately stubbed** and should be flagged, not quietly finished: `onAddContact` in Task 11 (needs `putContact`/`addToRadio` wiring) and the duplicate `useChannelStats` call between the header count and the body.
- **Do not add virtualisation.** It was explicitly cut. The rail stays one scroll container.
- **Do not bundle fonts.** `font-mono` resolving to SF Mono is why the count caps at 3 characters.
