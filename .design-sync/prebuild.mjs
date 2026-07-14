#!/usr/bin/env node
// design-sync prebuild for coresense (run as cfg.buildCmd before the converter).
// Three deterministic steps, all regenerable from repo source:
//   1. Compile the app's Tailwind v4 stylesheet → .design-sync/.cache/ds-tailwind.css
//      (cfg.cssEntry). Scans the components AND the authored previews so
//      preview-only layout utilities are included.
//   2. Emit real .d.ts for the 23 UI components → dist/types/ (so the converter
//      resolves accurate prop contracts instead of `[key:string]:unknown` stubs).
//   3. Generate the barrel index.d.ts the converter's propsBodyFor resolves as
//      its `entry` — named re-exports of ONLY the 23 primaries (componentSrcMap),
//      so discovery yields 23 cards while ui-entry.ts still bundles every export.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: repo, stdio: 'inherit' });

// 0. Safelist — designs built with this DS can only use utility classes present
// in the compiled stylesheet. The app's own source covers a broad on-brand set,
// but a design agent building NEW layouts needs headroom. Emit a synthetic file
// of common utilities + every theme color token (bg/text/border) so the Tailwind
// scan generates them. Written to the gitignored cache; regenerated each run.
console.error('[prebuild] generating utility safelist …');
const COLORS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'border', 'input', 'ring',
  'cs-bg', 'cs-bg-2', 'cs-bg-3', 'cs-text', 'cs-text-muted', 'cs-text-dim', 'cs-border',
  'cs-border-strong', 'cs-accent', 'cs-accent-soft', 'cs-online', 'cs-warn', 'cs-danger',
];
const SPACE = ['0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '10', '12', '14', '16', '20', '24'];
const FRAC = ['full', '1/2', '1/3', '2/3', '1/4', '3/4', '1/5', 'auto', 'fit', 'min', 'max', 'px', 'screen'];
const cls = [];
// display / flex / grid
cls.push('block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden', 'contents', 'table');
cls.push('flex-row', 'flex-col', 'flex-wrap', 'flex-nowrap', 'flex-1', 'flex-auto', 'flex-none', 'flex-initial', 'shrink', 'shrink-0', 'grow', 'grow-0');
for (const a of ['start', 'center', 'end', 'baseline', 'stretch']) cls.push(`items-${a}`, `self-${a}`, `content-${a}`);
for (const a of ['start', 'center', 'end', 'between', 'around', 'evenly']) cls.push(`justify-${a}`, `justify-items-${a}`);
for (const n of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']) cls.push(`grid-cols-${n}`, `col-span-${n}`, `grid-rows-${Math.min(+n, 6)}`);
cls.push('col-span-full', 'row-span-full', 'col-auto', 'grid-flow-row', 'grid-flow-col', 'place-items-center', 'place-content-center');
// spacing
for (const p of ['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr', 'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr', 'gap', 'gap-x', 'gap-y', 'space-x', 'space-y']) for (const s of SPACE) cls.push(`${p}-${s}`);
cls.push('mx-auto', 'my-auto', 'ml-auto', 'mr-auto');
// sizing
for (const d of ['w', 'h', 'min-w', 'min-h', 'max-w', 'max-h', 'size']) for (const s of [...SPACE, ...FRAC]) cls.push(`${d}-${s}`);
for (const s of ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'prose']) cls.push(`max-w-${s}`);
// typography
for (const s of ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl']) cls.push(`text-${s}`);
for (const w of ['thin', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold']) cls.push(`font-${w}`);
cls.push('font-mono', 'font-sans', 'italic', 'uppercase', 'lowercase', 'capitalize', 'normal-case', 'truncate', 'text-balance', 'text-pretty', 'tabular-nums', 'underline', 'no-underline', 'line-through', 'whitespace-nowrap', 'whitespace-pre', 'break-words', 'text-ellipsis');
for (const a of ['left', 'center', 'right', 'justify']) cls.push(`text-${a}`);
for (const l of ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose']) cls.push(`leading-${l}`);
for (const t of ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest']) cls.push(`tracking-${t}`);
for (const n of ['1', '2', '3', '4', '5', '6']) cls.push(`line-clamp-${n}`);
// colors
for (const c of COLORS) { cls.push(`bg-${c}`, `text-${c}`, `border-${c}`, `ring-${c}`, `fill-${c}`, `stroke-${c}`); }
for (const o of ['0', '5', '10', '20', '30', '40', '50', '60', '70', '80', '90']) for (const c of ['primary', 'destructive', 'cs-accent', 'foreground', 'cs-bg']) cls.push(`bg-${c}/${o}`, `text-${c}/${o}`, `border-${c}/${o}`);
// borders / radius / effects
cls.push('border', 'border-0', 'border-2', 'border-t', 'border-b', 'border-l', 'border-r', 'border-x', 'border-y', 'border-dashed', 'border-solid');
for (const r of ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']) cls.push(`rounded-${r}`, `rounded-t-${r}`, `rounded-b-${r}`, `rounded-l-${r}`, `rounded-r-${r}`);
for (const s of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'none', 'inner']) cls.push(`shadow-${s}`);
cls.push('shadow', 'ring', 'ring-1', 'ring-2', 'ring-0', 'ring-inset', 'outline-none');
for (const o of ['0', '5', '10', '20', '25', '30', '40', '50', '60', '70', '75', '80', '90', '95', '100']) cls.push(`opacity-${o}`);
// position / z / overflow
cls.push('relative', 'absolute', 'fixed', 'sticky', 'static', 'inset-0', 'inset-x-0', 'inset-y-0', 'top-0', 'right-0', 'bottom-0', 'left-0');
for (const z of ['0', '10', '20', '30', '40', '50']) cls.push(`z-${z}`);
for (const o of ['auto', 'hidden', 'scroll', 'visible', 'clip']) cls.push(`overflow-${o}`, `overflow-x-${o}`, `overflow-y-${o}`);
// interactivity / transitions / animation
cls.push('cursor-pointer', 'cursor-default', 'cursor-not-allowed', 'select-none', 'select-text', 'pointer-events-none', 'pointer-events-auto');
cls.push('transition', 'transition-all', 'transition-colors', 'transition-opacity', 'transition-transform', 'duration-100', 'duration-150', 'duration-200', 'duration-300', 'ease-in', 'ease-out', 'ease-in-out');
cls.push('animate-spin', 'animate-pulse', 'animate-none', 'animate-bounce');
const safelistHtml = `<!doctype html><html><body><div class="${cls.join(' ')}"></div></body></html>\n`;
const safelistDir = resolve(repo, '.design-sync/.cache/safelist');
execFileSync('mkdir', ['-p', safelistDir]);
writeFileSync(resolve(safelistDir, 'utilities.html'), safelistHtml);
console.error(`[prebuild] safelist: ${cls.length} utilities.`);

// 1. Tailwind
console.error('[prebuild] compiling Tailwind …');
// Scan the WHOLE renderer (not just components/) so the shipped stylesheet
// carries the app's full, on-brand utility vocabulary — designs built with this
// DS can only use classes present in this compiled CSS. Plus the authored
// previews so their layout utilities compile too.
run('node', [
  resolve(here, 'compile-tailwind.mjs'),
  'src/renderer/index.css',
  '.design-sync/.cache/ds-tailwind.css',
  'src/renderer,.design-sync/previews,.design-sync/.cache/safelist',
]);

// 2. Declaration emit
console.error('[prebuild] emitting component declarations (tsc) …');
const tsc = resolve(repo, 'node_modules/typescript/bin/tsc');
if (!existsSync(tsc)) {
  console.error('[prebuild] ERROR: typescript not installed at node_modules/typescript — run the repo install (pnpm i).');
  process.exit(1);
}
run('node', [tsc, '-p', resolve(here, 'tsconfig.dts.json')]);

// 3. Barrel
console.error('[prebuild] writing index.d.ts barrel …');
const cfg = JSON.parse(readFileSync(resolve(repo, '.design-sync/config.json'), 'utf8'));
const map = cfg.componentSrcMap ?? {};
const lines = Object.entries(map).map(([name, p]) => {
  const rel = String(p).replace(/\.(tsx|ts)$/, '');
  return `export { ${name} } from './dist/types/${rel}';`;
});
writeFileSync(resolve(repo, 'index.d.ts'), lines.join('\n') + '\n');
console.error(`[prebuild] done — ${lines.length} primaries in barrel.`);
