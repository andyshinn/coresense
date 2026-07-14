# design-sync notes — coresense

Repo-specific gotchas for syncing the CoreSense UI to claude.ai/design. Read
this before every re-sync.

## Shape & wiring

- **coresense is an Electron app, not a published component library.** There is
  no dist entry that exports the shadcn/ui primitives. The bundle entry is a
  hand-written re-export file, `.design-sync/ui-entry.ts` (committed), wired via
  `cfg.entry`. Keep it in sync with `cfg.componentSrcMap` when UI components are
  added/removed under `src/renderer/components/ui/`.
- `package.json` `main` points at the **Electron main** bundle
  (`.vite/build/index.js`) — never let the converter resolve that as the DS
  entry. The explicit `cfg.entry` avoids this.
- Components are pinned 1:1 to the 23 files in `src/renderer/components/ui/` via
  `cfg.componentSrcMap` (so compound shadcn exports like `DialogContent` ride in
  the bundle but only the 23 top-level primitives get cards). `sonner.tsx`'s
  primary export is `Toaster`.
- `@/` path alias (`@/* → src/renderer/*`) resolves through `cfg.tsconfig`
  (`./tsconfig.json`) in both the esbuild bundle and the preview builds.

## Styling — Tailwind v4 (compiled, not shipped)

- The shadcn components are styled **entirely by Tailwind v4 utility classes**;
  there is no per-component CSS, so `_ds_bundle.css` is empty. The styling comes
  from a **compiled** stylesheet.
- `cfg.buildCmd` compiles it: `.design-sync/compile-tailwind.mjs` runs the repo's
  own `@tailwindcss/node` + `@tailwindcss/oxide` (4.3.1) over
  `src/renderer/index.css`, scanning the **whole `src/renderer`** (for the app's
  full on-brand utility vocabulary), `.design-sync/previews`, and a generated
  **utility safelist** (`.design-sync/.cache/safelist/`, ~1240 common utilities +
  every theme color token), emitting `.design-sync/.cache/ds-tailwind.css`
  (gitignored cache, ~208 KB) — pointed at by `cfg.cssEntry`.
- **Why the safelist:** designs built with this DS can only use utility classes
  present in the shipped CSS. The app's source covers a broad set, but the
  safelist (generated in `prebuild.mjs`) adds headroom (grid-cols-N, spacing
  scales, all `bg-/text-/border-/ring-` color tokens, etc.) so the design agent
  isn't limited to classes the app already happens to use.
- **Build scripts are committed** under `.design-sync/` (NOT `.ds-sync/`, which is
  gitignored and only holds re-copyable converter scripts): `prebuild.mjs`,
  `compile-tailwind.mjs`, `tsconfig.dts.json`. They survive a fresh clone.
- **Re-sync risk:** `cfg.cssEntry` points at a gitignored cache file. ALWAYS run
  `cfg.buildCmd` before the converter (the driver does this when DS source
  changed; when in doubt, run it). On a fresh clone the cache is absent until
  `buildCmd` runs.
- **Re-sync risk:** after authoring/altering previews, re-run `cfg.buildCmd` so
  preview-only layout utility classes (e.g. `flex gap-4 p-6` in preview wrappers)
  are compiled into the stylesheet — otherwise preview cards lay out unstyled.
- The DS theme is **dark by default** (`color-scheme: dark`; the `--cs-*` "Field
  Console" palette `:root` values are dark-mode). Light-mode values are applied
  by `applyTheme()` JS at runtime in the app and are NOT relevant to previews.

## Component prop contracts (.d.ts) — emitted, not shipped

- The repo ships **no `.d.ts`** for the UI components, so the converter would
  emit `[key: string]: unknown` stubs (useless to the design agent). `cfg.buildCmd`
  (`.design-sync/prebuild.mjs`) fixes this:
  1. `tsc -p .design-sync/tsconfig.dts.json` emits real declarations for the 23 UI
     components → `dist/types/` (gitignored; `dist/` is already ignored).
  2. It writes a **barrel `index.d.ts`** at the repo root (gitignored) with
     **named** re-exports of ONLY the 23 primaries (from `cfg.componentSrcMap`).
- Why named (not `export *`): the converter resolves `propsBodyFor` against the
  barrel as its `entry`, and derives the card list from the barrel's exports. A
  `export *` barrel re-exports every sub-part (DialogContent, SheetHeader, …) and
  blows the card count up to ~92. Named-23 keeps exactly 23 cards while
  `ui-entry.ts` still bundles **every** export onto `window.CoreSenseUI` (so
  previews can compose DialogContent etc.).
- `findTypesRoot` finds `dist/types` because it's in its search list; a **dot**
  dir like `.design-sync/.cache/types` is invisible to the converter's fast-glob
  (`dot:false`) — that's why declarations go to `dist/types`, not the cache.

## Tooling

- Converter deps (esbuild, ts-morph, @types/react) install into `.ds-sync/`
  (isolated from the repo's pnpm lockfile).
- The repo uses **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml`); install with
  `pnpm i --frozen-lockfile`.

## Re-sync risks (watch-list)

- `cfg.cssEntry` is a generated cache file — see styling notes above.
- `.design-sync/ui-entry.ts` and `cfg.componentSrcMap` must both be updated when
  the `src/renderer/components/ui/` set changes; a new component added to one but
  not the other is silently dropped (missing from cards or missing from bundle).
- `dist/types/` + root `index.d.ts` are generated by `cfg.buildCmd` and gitignored
  — absent on a fresh clone until `buildCmd` runs. Always run `buildCmd` before the
  converter (the driver does when source changed; when in doubt, run it).
- The barrel is derived from `cfg.componentSrcMap`, so adding/removing a component
  there automatically updates both the card list and the prop contracts.
- **Machine render gate now runs.** The 2026-07-13 re-sync installed Playwright
  Chromium (`npx playwright install chromium` → `chromium-1228`, cached under
  `~/Library/Caches/ms-playwright/` on macOS, matching repo pin `playwright@1.61.0`)
  and ran the full gate (`resync.mjs … --render-sample 0`): **23/23 render cleanly,
  bad=0, thin=0, variantsIdentical=0, fallbackCard=0**. All 23 were also dual-graded
  `good` (standard + adversarial grader) and grade.json written for each. The earlier
  "human review only, no Chromium" caveat no longer applies — re-syncs can run the
  machine gate directly (Chromium already cached).
- **`ds-bundle/` must be clean before the driver.** A leftover skeleton (empty
  component dirs from a prior run, no `.ds-bundle` marker) trips `[OUT_UNSAFE]`.
  `ds-bundle/` is now gitignored; `rm -rf ds-bundle` before the driver if a stale
  tree exists.
- **Diff churn on re-sync is normal.** With an unchanged component set, `renderHashes`
  churn globally (Tailwind recompile shifts every screenshot) while `sourceKeys` stay
  `unchanged`; the driver spot-checks a canary and `upload.any` is still true (bundle
  bytes changed). Not a regression — expected pipeline churn.
- **Durable set now lives on `main`.** As of 2026-07-13 the `.design-sync/` durable
  files (config, NOTES, conventions, previews, fonts, scripts, `ui-entry.ts`,
  `tsconfig.dts.json`) are committed on `main`; `.gitignore` now ignores only
  `.design-sync/.cache/`, `.design-sync/learnings/`, `.design-sync/node_modules`
  (not the whole dir). The old unmerged branch `design-sync/coresense-ui` is
  superseded.
- Fonts: only **Inter** (sans) is vendored (`.design-sync/fonts/`). JetBrains Mono
  / SF Mono are declared host-provided via `cfg.runtimeFontPrefixes` (the mono
  stack leads with `ui-monospace`), so `[FONT_MISSING]` is expected-suppressed,
  not unresolved.
