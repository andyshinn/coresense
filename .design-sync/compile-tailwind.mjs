#!/usr/bin/env node
// Compile the app's Tailwind v4 stylesheet into a static CSS file the
// design-sync converter can ship as cfg.cssEntry. The shadcn components are
// styled entirely by Tailwind utility classes (no per-component CSS), so the
// preview cards and every design built with this DS need the compiled
// utilities + the --cs-* token :root/@theme blocks from src/renderer/index.css.
//
// Usage: node .ds-sync/compile-tailwind.mjs <input.css> <out.css> <scanDir>[,<scanDir>...]
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [inputArg, outArg, scanArg] = process.argv.slice(2);
if (!inputArg || !outArg) {
  console.error('usage: compile-tailwind.mjs <input.css> <out.css> <scanDir,...>');
  process.exit(1);
}
const input = resolve(inputArg);
const out = resolve(outArg);
const base = dirname(input);
const scanDirs = (scanArg ? scanArg.split(',') : [])
  .map((d) => resolve(d))
  .filter((d) => existsSync(d));

const css = readFileSync(input, 'utf8');
const compiler = await compile(css, {
  base,
  onDependency() {},
});

console.error('[compiler keys]', Object.keys(compiler).join(', '));
console.error('[compiler.sources]', JSON.stringify(compiler.sources ?? compiler.globs ?? null));

// Explicit sources guarantee the component + preview classes are scanned,
// regardless of automatic-content-detection base. Merge any @source globs the
// compiler resolved from the CSS itself (so negated dirs like resources/ are
// honored) with our explicit component/preview dirs.
const explicit = scanDirs.map((d) => ({
  base: d,
  pattern: '**/*.{ts,tsx,js,jsx,html,mdx}',
  negated: false,
}));
const fromCss = Array.isArray(compiler.sources) ? compiler.sources : [];
const sources = [...fromCss, ...explicit];

const scanner = new Scanner({ sources });
const candidates = scanner.scan();
console.error(`[candidates] ${candidates.length}`);

let outputCss = compiler.build(candidates);
try {
  outputCss = optimize(outputCss, { minify: false }).code ?? outputCss;
} catch (e) {
  console.error('[optimize skipped]', e.message);
}
writeFileSync(out, outputCss);
console.error(`[wrote] ${out} (${(outputCss.length / 1024).toFixed(0)} KB)`);
