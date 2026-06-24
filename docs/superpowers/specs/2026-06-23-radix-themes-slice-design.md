# Radix Themes Slice — Design Spec

- **Date:** 2026-06-23
- **Status:** Approved (design); pending spec review
- **Branch / worktree:** `worktree-feat+radix-themes-slice` at `.claude/worktrees/feat+radix-themes-slice`
- **Type:** Exploratory UI refactor — evaluate an all-Radix component design on a representative slice

## Goal

See what the app looks like rendered with **Radix Themes** (the fully-styled component library) plus **Radix Colors**, **Radix Icons**, and **Radix Primitives**, replacing the current shadcn + Tailwind styling on a representative slice. The output is a runnable preview we can eyeball and toggle, not a finished migration.

## Non-goals

- Full migration of all 23 `ui/` components or all 34 consumers.
- Removing shadcn `ui/` components or Tailwind from the repo.
- Converting Map, Search, Logs, Repeater-admin, or the command-palette feature.
- Converting the *layout* of every Settings section (see Known Seams).
- Changing app behavior, data flow, IPC, or protocol.

## Current state (as surveyed)

- shadcn (new-york) components in `src/renderer/components/ui/` (23 components) already wrap the `radix-ui` **primitives** package. shadcn is the Tailwind-styled skin.
- Styling: **Tailwind v4** with `@theme` blocks + a custom **"Field Console"** palette (`--cs-*` CSS vars) written at runtime by `applyTheme()` in `src/renderer/lib/theme.ts` (dark default + light variant).
- shadcn semantic tokens (`--color-background`, `--color-primary`, …) are mapped to the `cs-*` palette in `src/renderer/index.css`.
- Icons: `lucide-react`.
- Settings form controls are **centralized** in `src/renderer/components/settings/Field.tsx` (167 lines: `Row`, `Toggle`, `Select`, `NumberInput`, `TextInput`, `Section`, `PanelShell`) — hand-rolled with Tailwind, not per-section. Converting this one file re-skins every settings section's controls.
- Dependencies present: `radix-ui` (primitives), `lucide-react`, `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`. **Not present:** `@radix-ui/themes`, `@radix-ui/react-icons`.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Scope | Representative slice: **Shell (left nav + right rail) + Settings** |
| Aesthetic | Live **Theme Playground** with dropdowns (not fixed presets); default to a warm preset; `tomato` + solid panel reachable via dropdown |
| Tailwind | **Pure Radix layout** in converted files (Flex/Grid/Box/Text/Heading), no Tailwind layout utilities |
| Library surface | Radix **Themes + Colors + Icons + Primitives** |
| Integration | **Approach A** — single `<Theme>` at the app root wrapping the whole app |

## Architecture

### Dependencies to add

- `@radix-ui/themes` — component library + tokens + `styles.css`.
- `@radix-ui/react-icons` — icon set for the slice.
- Radix **Colors** ship inside `@radix-ui/themes`; the accent/gray dropdowns *are* Radix Colors. A separate `@radix-ui/colors` install is only needed if we reference raw scales directly — not planned.

### Theme provider (Approach A)

In `src/renderer/App.tsx`:

- `import "@radix-ui/themes/styles.css";` once.
- Wrap the app tree in `<Theme>`:
  ```tsx
  <Theme
    appearance={radixAppearance}        // bridged from existing theme pref
    accentColor={pg.accentColor}         // from Theme Playground
    grayColor={pg.grayColor}             // from Theme Playground
    panelBackground={pg.panelBackground} // from Theme Playground
    radius="medium"
    scaling="100%"
  >
    {app}
  </Theme>
  ```
- Radix Themes scopes its styles/reset under the `.radix-themes` class that `<Theme>` applies. Because `<Theme>` wraps the whole app, that reset reaches the shadcn panels too — see Risks for the bleed check and the scoped-`<Theme>` fallback.

### Theme Playground (the live control)

- **Location:** Settings → Appearance section (`src/renderer/panels/settings/app/Appearance.tsx`), next to the existing theme controls.
- **Controls:**
  - **Accent** dropdown — all 26 Radix accents (gray, gold, bronze, brown, yellow, **amber**, orange, **tomato**, red, ruby, crimson, pink, plum, purple, violet, iris, indigo, blue, cyan, teal, jade, green, grass, lime, mint, sky).
  - **Gray** dropdown — auto, gray, mauve, slate, sage, olive, sand.
  - **Panel background** — translucent / **solid**.
  - **Radius and scaling are out of scope** for this slice — set as static `<Theme>` defaults (`radius="medium"`, `scaling="100%"`), not exposed as Playground controls.
- **Appearance (light/dark)** is **not** a playground control — it stays driven by the existing theme pref (`auto/light/dark`) to avoid two sources of truth. The playground governs accent/gray/panel-bg only.
- **State + persistence:** a small **dedicated zustand store** (matching the existing `lib/store` pattern) holding `{ accentColor, grayColor, panelBackground }`, persisted to `localStorage` (`coresense.radixThemePlayground`) so selections survive reloads while evaluating. Default = warm preset: `accentColor: "amber"`, `grayColor: "sand"`, `panelBackground: "translucent"`.
- The root `<Theme>` reads this store; the Appearance dropdowns write to it. Store must be provided above `<Theme>` in the tree.

### Theme-system reconciliation

- `radixAppearance` = `resolveTheme(themePref, systemDark)` → `'dark' | 'light'`, passed to `<Theme appearance>`.
- `applyTheme()` keeps writing `--cs-*` vars and toggling `.dark` for the **un-converted** shadcn panels — untouched.
- Net: existing light/dark toggle drives both the cs-* palette (shadcn panels) and Radix appearance (converted slice) consistently.

## Component mapping

### Shell — `src/renderer/shell/leftnav/` + `src/renderer/shell/rightrail/`

| Current | Radix Themes target |
|---|---|
| `ui/sidebar` (10 uses) | No Themes equivalent → rebuild nav from `Flex`/`Box`/`ScrollArea` + `Collapsible` primitive + ghost `Button`/`Text` |
| `ui/popover` | `Popover.*` |
| `ui/dialog` | `Dialog.*` |
| `ui/progress` | `Progress` |
| `ui/hover-card` | `HoverCard.*` |
| `ui/KeyValueRow` (`KeyValueRow` / `KeyValueGroup`) | `DataList.*` (`DataList.Root` / `Item` / `Label` / `Value`) — **shared rail layer**: converting this one file re-skins every metadata rail (ChannelInfo, ContactDetail, MessageInfo, VersionSection, ContactManagerRail), mirroring the `Field.tsx` trick for Settings |
| Right-rail Dialogs (ContactDetail, ContactManagerRail) | `Dialog.*` / `AlertDialog.*` (block/remove/clear confirmations) |
| Context menus (`ContactContextMenu`, `ChannelContextMenu`, `contextMenu.tsx`) | `DropdownMenu.*` / `ContextMenu.*` |
| `lucide-react` icons | `@radix-ui/react-icons` |

### Settings

**Core (re-skins all sections' controls):**

| File | Conversion |
|---|---|
| `components/settings/Field.tsx` | `Toggle→Switch`, `Select→Select.*`, `NumberInput/TextInput→TextField.Root`, `Row/Section→Flex/Grid + Text`, `PanelShell→layout` |
| `components/settings/SettingsSection.tsx` | layout → `Card`/`Section` + `Heading`/`Text` |
| `panels/settings/SettingsPanel.tsx` | panel chrome → Radix layout |
| `panels/settings/PillTabs.tsx` | `SegmentedControl` (or `Tabs`) |
| `panels/settings/StatusPill.tsx` | `Badge` |
| `panels/settings/UnsavedChangesDialog.tsx` | `AlertDialog` (or `Dialog`) |
| `panels/settings/ExtraSections.tsx` | composition/layout |

**Showcase sections — fully converted to pure Radix layout (so complete sections render, not just controls):**

- `panels/settings/app/Appearance.tsx` — **+ Theme Playground**; Select controls.
- `panels/settings/app/Behavior.tsx` — Switch (Toggle) + Select + numeric `TextField` (NumberInput).
- `panels/settings/radio/Telemetry.tsx` — Select controls.

> **Correction:** an earlier draft listed "Slider" in these sections. That was a false match on the `SlidersHorizontal` lucide *icon* — no settings section uses a Slider component; numeric fields use `NumberInput`. Radix `Slider` is therefore **not exercised by this slice** (the one `ui/slider` consumer lives outside it). `NumberInput` fields map to Radix `TextField` with `type="number"`, preserving behavior.

## Icons

Swap `lucide-react` → `@radix-ui/react-icons` where a good match exists. **Reality check from the file survey:** the slice uses many domain glyphs that Radix Icons (a curated ~300-icon set focused on generic UI) simply does not cover — e.g. `Bluetooth`, `Radio`, `Map`, `Megaphone`, `Inbox`, `Activity`, `ArrowUpCircle`, `RotateCw`, `ShieldCheck`, `TerminalSquare`, `MessageSquare`, `FolderInput`. Forcing Radix Icons everywhere would degrade the UI. Strategy:

1. Use Radix Icons for the generic affordances that *do* have clean matches: `MagnifyingGlassIcon` (Search), `PlusIcon`/`MinusIcon`, `Cross2Icon` (X), `ChevronRightIcon`/`ChevronLeftIcon`, `CopyIcon`, `CheckIcon`, `StarIcon`/`StarFilledIcon`, `GearIcon` (Cog/Settings), `TrashIcon` (Trash2), `Pencil2Icon`, `DotsHorizontalIcon` (MoreHorizontal), `BellIcon` family where present.
2. **Keep the lucide-react icon** for any domain glyph with no acceptable Radix equivalent — expect this to be a sizable set, not a couple of one-offs.
3. The implementation produces a concrete per-icon mapping table (Radix vs retained-lucide) so the split is explicit and reviewable.

## Layout (pure Radix)

In converted files, replace Tailwind layout utilities with Radix layout primitives: `Flex`, `Grid`, `Box`, `Section`, `Container`, `Text`, `Heading`, `ScrollArea`, `Card`, using token props (`gap`, `p`, `px`, `align`, `justify`, `direction`). Tailwind classes remain available repo-wide for un-converted code.

## Known seams (intentional, called out)

- The ~15 Settings sections **not** in the showcase list immediately get Radix-styled **controls** (via the converted `Field.tsx`) but keep their existing Tailwind **section-layout** until a later full pass. Expect mixed layout density in those sections — this is intended for the slice, not a bug.
- shadcn panels (Map/Search/Logs/Repeater-admin) render unchanged inside the root `<Theme>`; verify no visible reset bleed (Risks).

## Testing & verification

- **Primary (visual):** run the app (`pnpm start`, electron-forge) and eyeball the shell + Settings across accent/gray/panel-bg combinations and light/dark.
- **Automated:** `pnpm typecheck` (tsc) must pass; `pnpm test` (vitest) must stay green. Converting markup will break dom-tests that assert shadcn-specific structure/classes — update those selectors to match Radix output while preserving behavior assertions. Mind the renderer dom-test flush timing caveat (use `flushSync` in harnesses where discrete-flush ordering matters).
- **Lint:** `pnpm lint` scoped to `src tests` (repo-wide biome flags pre-existing build artifacts).
- This is a behavior-preserving refactor, so verification is parity-driven rather than new-feature TDD: keep tests green, add tests only where conversion introduces genuinely new logic (e.g. the Theme Playground store).

## Risks & mitigations

1. **Radix reset bleed** into shadcn panels (whole app is inside `.radix-themes`). *Mitigation:* visual check of un-converted panels; if bleed is material, fall back to scoping `<Theme>` to the converted subtrees (Approach B) — accepting that portaled content then needs its own `<Theme>` wrapper.
2. **Icon gaps** in Radix Icons. *Mitigation:* nearest-match + documented lucide one-offs.
3. **Test breakage** from markup changes. *Mitigation:* update selectors; keep behavior assertions.
4. **Two styling systems' CSS load order** in Electron/Vite. *Mitigation:* import `@radix-ui/themes/styles.css` before app CSS; verify cascade.
5. **Mixed-layout seam** misread as unfinished. *Mitigation:* documented above; surfaced in the implementation summary.

## Rollback

All work is isolated in the `worktree-feat+radix-themes-slice` branch/worktree. Discarding the worktree (ExitWorktree → remove, or delete the branch) fully reverts; `main` is untouched.

## Open implementation references

Exact Radix Themes APIs (prop enums, component sub-parts) to be confirmed against current docs via Context7 during planning/implementation.
