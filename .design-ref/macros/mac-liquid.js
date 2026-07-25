// mac-liquid.js — a focused Liquid-ish engine for MeshCore macros.
//
// Macros are output expressions only: literal text interleaved with
// {{ variable | filter: arg | … }} tags (no tags/loops/if — that's all the
// feature needs). This module powers three things from ONE parse:
//   • highlight(src, mode)          → colored runs for the editor overlay
//   • render(src, ctx, mode)        → preview segments + char length + errors
//   • the validator                 → distinct error classes (syntax,
//                                      unknown-var, unknown-filter, unavailable)
//
// "Empty/missing" values render a placeholder ('?'); unknown names are errors.
// In "send" mode only the always-available variables resolve; reply-only ones
// are flagged unavailable (greyed, not red).

window.MAC_LIQUID = (() => {
  const D = window.MAC_DATA;
  const PLACEHOLDER = '?';

  const varNames   = new Set(D.variables.map(v => v.name));
  const alwaysNames = new Set(D.variables.filter(v => v.group === 'always').map(v => v.name));
  const replyNames = new Set(D.variables.filter(v => v.group === 'reply').map(v => v.name));
  const filterMap  = Object.fromEntries(D.filters.map(f => [f.name, f]));

  const availableInMode = (name, mode) =>
    mode === 'send' ? alwaysNames.has(name) : varNames.has(name);

  // ── tiny tokenizer over a tag's inner text ───────────────────────────
  function lex(inner, base) {
    const toks = [];
    let i = 0;
    const re = {
      ws: /\s/, idStart: /[a-zA-Z_]/, idPart: /[a-zA-Z0-9_.]/,
      num: /[-0-9.]/,
    };
    while (i < inner.length) {
      const c = inner[i];
      if (re.ws.test(c)) { i++; continue; }
      const start = base + i;
      if (c === '|') { toks.push({ t: 'pipe', v: c, start, end: start + 1 }); i++; continue; }
      if (c === ':') { toks.push({ t: 'colon', v: c, start, end: start + 1 }); i++; continue; }
      if (c === ',') { toks.push({ t: 'comma', v: c, start, end: start + 1 }); i++; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1; while (j < inner.length && inner[j] !== c) j++;
        const v = inner.slice(i + 1, j);
        toks.push({ t: 'string', v, start, end: base + Math.min(j + 1, inner.length) });
        i = j + 1; continue;
      }
      if (re.idStart.test(c)) {
        let j = i + 1; while (j < inner.length && re.idPart.test(inner[j])) j++;
        toks.push({ t: 'ident', v: inner.slice(i, j), start, end: base + j });
        i = j; continue;
      }
      if (/[-0-9]/.test(c)) {
        let j = i + 1; while (j < inner.length && /[0-9.]/.test(inner[j])) j++;
        toks.push({ t: 'number', v: inner.slice(i, j), start, end: base + j });
        i = j; continue;
      }
      // unrecognized char
      toks.push({ t: 'bad', v: c, start, end: start + 1 }); i++;
    }
    return toks;
  }

  // Parse one tag's inner text into an AST. innerStart = absolute index of
  // the first char after "{{".
  function parseTag(inner, innerStart, rawStart, rawEnd) {
    const toks = lex(inner, innerStart);
    if (!toks.length) {
      return { error: { type: 'syntax', message: 'Empty tag', start: rawStart, end: rawEnd } };
    }
    let p = 0;
    const peek = () => toks[p];
    const primary = toks[p++];
    if (primary.t !== 'ident' && primary.t !== 'string' && primary.t !== 'number') {
      return { error: { type: 'syntax', message: `Unexpected “${primary.v}”`, start: primary.start, end: primary.end } };
    }
    const filters = [];
    while (p < toks.length) {
      const pipe = toks[p++];
      if (pipe.t !== 'pipe') {
        return { error: { type: 'syntax', message: `Expected “|” before “${pipe.v}”`, start: pipe.start, end: pipe.end } };
      }
      const name = toks[p++];
      if (!name || name.t !== 'ident') {
        return { error: { type: 'syntax', message: 'Filter name expected after “|”', start: pipe.start, end: pipe.end } };
      }
      const args = [];
      if (peek() && peek().t === 'colon') {
        p++; // consume colon
        // arg list
        // first arg required
        while (true) {
          const a = toks[p++];
          if (!a || (a.t !== 'ident' && a.t !== 'string' && a.t !== 'number')) {
            return { error: { type: 'syntax', message: `Argument expected for “${name.v}”`, start: name.start, end: name.end } };
          }
          args.push(a);
          if (peek() && peek().t === 'comma') { p++; continue; }
          break;
        }
      }
      filters.push({ name, args });
    }
    return { primary, filters, rawStart, rawEnd };
  }

  // Walk the source into [text | tag] nodes; handles an unclosed "{{".
  function scan(src) {
    const nodes = [];
    let i = 0;
    while (i < src.length) {
      if (src[i] === '{' && src[i + 1] === '{') {
        const close = src.indexOf('}}', i + 2);
        if (close === -1) {
          nodes.push({ kind: 'unclosed', start: i, end: src.length, raw: src.slice(i) });
          break;
        }
        const inner = src.slice(i + 2, close);
        const ast = parseTag(inner, i + 2, i, close + 2);
        nodes.push({ kind: 'tag', start: i, end: close + 2, raw: src.slice(i, close + 2), ast });
        i = close + 2;
      } else {
        const next = src.indexOf('{{', i);
        const end = next === -1 ? src.length : next;
        nodes.push({ kind: 'text', start: i, end, raw: src.slice(i, end) });
        i = end;
      }
    }
    return nodes;
  }

  // Classify an ident used as a *variable* (primary or var-arg).
  function classifyVar(name, mode) {
    const base = name.split('.')[0];
    if (!varNames.has(base)) return 'error';
    if (mode === 'send' && replyNames.has(base)) return 'unavail';
    return 'variable';
  }
  function classifyFilter(name) {
    const f = filterMap[name];
    if (!f) return 'error';
    return f.custom ? 'custom' : 'filter';
  }

  // ── highlight ─────────────────────────────────────────────────────────
  // Returns { runs:[{text,type}], errors:[…] } — runs tile the whole src.
  function highlight(src, mode = 'reply') {
    const type = new Array(src.length).fill('text');
    const errors = [];
    const paint = (s, e, t) => { for (let k = s; k < e && k < src.length; k++) type[k] = t; };

    for (const node of scan(src)) {
      if (node.kind === 'unclosed') {
        paint(node.start, node.end, 'error');
        errors.push({ severity: 'error', type: 'syntax', message: 'Unclosed “{{” — expected “}}”' });
        continue;
      }
      if (node.kind !== 'tag') continue;
      paint(node.start, node.end, 'delim');
      const ast = node.ast;
      if (ast.error) {
        paint(ast.error.start, ast.error.end, 'error');
        errors.push({ severity: 'error', type: ast.error.type, message: ast.error.message });
        continue;
      }
      // primary
      const pr = ast.primary;
      if (pr.t === 'string') paint(pr.start, pr.end, 'string');
      else if (pr.t === 'number') paint(pr.start, pr.end, 'number');
      else {
        const cls = classifyVar(pr.v, mode);
        paint(pr.start, pr.end, cls);
        if (cls === 'error') errors.push({ severity: 'error', type: 'unknown-var', message: `Unknown variable “${pr.v.split('.')[0]}”`, name: pr.v });
        else if (cls === 'unavail') errors.push({ severity: 'warn', type: 'unavailable', message: `“${pr.v}” isn’t available when composing a new message`, name: pr.v });
      }
      // filters + args
      for (const f of ast.filters) {
        const fcls = classifyFilter(f.name.v);
        paint(f.name.start, f.name.end, fcls);
        if (fcls === 'error') errors.push({ severity: 'error', type: 'unknown-filter', message: `Unknown filter “${f.name.v}”`, name: f.name.v });
        for (const a of f.args) {
          if (a.t === 'string') paint(a.start, a.end, 'string');
          else if (a.t === 'number') paint(a.start, a.end, 'number');
          else {
            const cls = classifyVar(a.v, mode);
            paint(a.start, a.end, cls);
            if (cls === 'error') errors.push({ severity: 'error', type: 'unknown-var', message: `Unknown variable “${a.v.split('.')[0]}”`, name: a.v });
            else if (cls === 'unavail') errors.push({ severity: 'warn', type: 'unavailable', message: `“${a.v}” isn’t available when composing a new message`, name: a.v });
          }
        }
      }
    }

    // coalesce
    const runs = [];
    let cur = null;
    for (let k = 0; k < src.length; k++) {
      if (cur && cur.type === type[k]) cur.text += src[k];
      else { cur = { text: src[k], type: type[k] }; runs.push(cur); }
    }
    // dedupe errors by message
    const seen = new Set();
    const uniq = errors.filter(e => { const key = e.type + e.message; if (seen.has(key)) return false; seen.add(key); return true; });
    return { runs, errors: uniq };
  }

  // ── value helpers ───────────────────────────────────────────────────
  const isEmpty = (v) => v === undefined || v === null || v === '' ||
    (typeof v === 'object' && !Array.isArray(v) && (v.lat === undefined || v.lat === null) && (v.lon === undefined || v.lon === null));

  function getPath(ctx, name) {
    const parts = name.split('.');
    let v = ctx[parts[0]];
    for (let k = 1; k < parts.length; k++) v = (v == null ? undefined : v[parts[k]]);
    return v;
  }

  function fmt(v) {
    if (isEmpty(v)) return null;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      if (!v.length) return null;
      if (v.every(x => typeof x !== 'object')) return v.join(', ');
      return v.map(x => x && x.name ? x.name : '·').join(', ');
    }
    if (typeof v === 'object') {
      if (v.lat !== undefined && v.lon !== undefined) return `${v.lat}, ${v.lon}`;
      return '·';
    }
    return String(v);
  }

  // distance/bearing in meters / degrees
  function haversine(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
    const la1 = a.lat * toR, la2 = b.lat * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function bearing(a, b) {
    const toR = Math.PI / 180, toD = 180 / Math.PI;
    const dLon = (b.lon - a.lon) * toR;
    const y = Math.sin(dLon) * Math.cos(b.lat * toR);
    const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos(dLon);
    let deg = (Math.atan2(y, x) * toD + 360) % 360;
    return { deg: Math.round(deg), pt: COMPASS[Math.round(deg / 22.5) % 16] };
  }
  function fmtUnit(meters, unit, appUnits) {
    const u = unit || appUnits || 'km';
    if (u === 'mi') {
      const mi = meters / 1609.34;
      return mi < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${mi.toFixed(1)} mi`;
    }
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  }

  // Apply one filter to a value. Returns { val } or { empty:true } or
  // { error } (unknown filter handled before this).
  function applyFilter(name, val, args, ctx, mode, appUnits) {
    // resolve args to concrete values
    const argVals = [];
    for (const a of args) {
      if (a.t === 'string') argVals.push(a.v);
      else if (a.t === 'number') argVals.push(Number(a.v));
      else {
        if (!varNames.has(a.v.split('.')[0])) return { error: { type: 'unknown-var', message: `Unknown variable “${a.v}”` } };
        argVals.push(getPath(ctx, a.v));
      }
    }
    switch (name) {
      case 'distance': {
        const b = argVals[0];
        if (isEmpty(val) || isEmpty(b)) return { empty: true };
        return { val: Math.round(haversine(val, b)) };
      }
      case 'bearing': {
        const b = argVals[0];
        if (isEmpty(val) || isEmpty(b)) return { empty: true };
        const r = bearing(val, b);
        return { val: `${r.deg}° ${r.pt}` };
      }
      case 'unit': {
        if (isEmpty(val)) return { empty: true };
        const m = typeof val === 'number' ? val : Number(val);
        if (Number.isNaN(m)) return { empty: true };
        return { val: fmtUnit(m, argVals[0], appUnits) };
      }
      case 'first': return Array.isArray(val) && val.length ? { val: val[0] } : { empty: true };
      case 'last':  return Array.isArray(val) && val.length ? { val: val[val.length - 1] } : { empty: true };
      case 'size':  return { val: Array.isArray(val) ? val.length : (val == null ? 0 : String(val).length) };
      case 'join':  {
        const sep = argVals[0] != null ? String(argVals[0]) : ' ';
        if (!Array.isArray(val)) return { empty: true };
        return { val: val.map(x => (x && typeof x === 'object' ? (x.name ?? '·') : x)).join(sep) };
      }
      case 'sort': {
        if (!Array.isArray(val)) return { empty: true };
        const key = argVals[0];
        const arr = val.slice().sort((x, y) => {
          const xv = key != null && typeof x === 'object' ? x[key] : x;
          const yv = key != null && typeof y === 'object' ? y[key] : y;
          return xv < yv ? -1 : xv > yv ? 1 : 0;
        });
        return { val: arr };
      }
      case 'map': {
        const key = argVals[0];
        // documented example maps over a *path's* node chain — a single path
        // object exposes its `.hops` to map.
        if (Array.isArray(val)) return { val: val.map(x => (x && typeof x === 'object' ? x[key] : undefined)) };
        if (val && typeof val === 'object' && Array.isArray(val.hops)) return { val: val.hops.map(h => h[key]) };
        return { empty: true };
      }
      default: return { empty: true };
    }
  }

  function evalTag(node, ctx, mode, appUnits) {
    const ast = node.ast;
    if (ast.error) return { kind: 'error', text: node.raw, message: ast.error.message };
    const pr = ast.primary;
    let val, unavail = false;
    if (pr.t === 'string') val = pr.v;
    else if (pr.t === 'number') val = Number(pr.v);
    else {
      const base = pr.v.split('.')[0];
      if (!varNames.has(base)) return { kind: 'error', text: node.raw, message: `Unknown variable “${base}”` };
      if (mode === 'send' && replyNames.has(base)) unavail = true;
      val = getPath(ctx, pr.v);
    }
    for (const f of ast.filters) {
      if (!filterMap[f.name.v]) return { kind: 'error', text: node.raw, message: `Unknown filter “${f.name.v}”` };
      const r = applyFilter(f.name.v, val, f.args, ctx, mode, appUnits);
      if (r.error) return { kind: 'error', text: node.raw, message: r.error.message };
      if (r.empty) { val = null; break; }
      val = r.val;
    }
    const s = fmt(val);
    if (s === null) return { kind: unavail ? 'unavail' : 'placeholder', text: PLACEHOLDER };
    return { kind: unavail ? 'unavail' : 'out', text: s };
  }

  // ── render ────────────────────────────────────────────────────────────
  // ctx: sample data; mode: 'reply' | 'send'; appUnits: 'km' | 'mi'.
  function render(src, ctx, mode = 'reply', appUnits = 'km') {
    const segments = [];
    let length = 0, hasError = false;
    for (const node of scan(src)) {
      if (node.kind === 'text') { if (node.raw) { segments.push({ kind: 'out', text: node.raw }); length += node.raw.length; } continue; }
      if (node.kind === 'unclosed') { segments.push({ kind: 'error', text: node.raw, message: 'Unclosed tag' }); hasError = true; continue; }
      const r = evalTag(node, ctx, mode, appUnits);
      segments.push(r);
      if (r.kind === 'error') hasError = true;
      else length += r.text.length;
    }
    const plain = segments.filter(s => s.kind !== 'error').map(s => s.text).join('');
    return { segments, length, plain, hasError };
  }

  // Worst-case rendered length, using the "max" sample context. Errors make
  // the count meaningless, so report null then.
  function worstCase(src, mode = 'reply', appUnits = 'km') {
    const r = render(src, D.contexts.max, mode, appUnits);
    return r.hasError ? null : r.length;
  }

  return { highlight, render, worstCase, PLACEHOLDER, varNames, filterMap };
})();
