#!/usr/bin/env node
// Dump every companion-frame hex string from a CoreSense log file. The logger
// writes `hex=<hexstring>` (full de-framed frame) on BLE_RX / PROXY_TX lines,
// wrapped in ANSI color codes. We strip the ANSI, pull the hex, and print one
// per line prefixed with the leading code byte so you can pick fixtures.
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/extract-fixtures.mjs <logfile>');
  process.exit(1);
}

const ANSI = /\[[0-9;]*m/g;
const text = readFileSync(path, 'utf8').replace(ANSI, '');
const seen = new Set();
for (const line of text.split('\n')) {
  const m = line.match(/hex=([0-9a-fA-F]+)/);
  if (!m) continue;
  const hex = m[1].toLowerCase();
  if (hex.length < 2 || seen.has(hex)) continue;
  seen.add(hex);
  const code = hex.slice(0, 2);
  console.log(`0x${code}\t${hex.length / 2}B\t${hex}`);
}
console.log(`\n${seen.size} unique frames`);
