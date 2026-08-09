// cli-engine.js — pure logic behind the prompt: what is being typed, what to
// suggest, what it costs on the air, and what the repeater says back.
window.CLI_ENGINE = (() => {
  const D = window.CLI_DATA;
  const byName = Object.fromEntries(D.commands.map((c) => [c.name, c]));

  // ── Availability ─────────────────────────────────────────────────────
  // Why a command can't be run right now, or null when it can.
  function blockedReason(cmd, auth) {
    if (cmd.serial) return { tag: 'serial only', why: 'This command only runs on a wired serial console — it is never answered over the air.' };
    if (cmd.admin && auth !== 'admin') return { tag: 'admin', why: 'Requires an admin session with this repeater.', action: 'login' };
    return null;
  }

  // ── Matching ─────────────────────────────────────────────────────────
  // Returns { score, ranges } or null. Prefix beats word-start beats
  // subsequence beats description hit.
  function match(q, cmd) {
    if (!q) return { score: 1, ranges: [] };
    const name = cmd.name, ln = name.toLowerCase(), lq = q.toLowerCase();
    const at = ln.indexOf(lq);
    if (at === 0) return { score: 1000 - name.length, ranges: [[0, lq.length]] };
    if (at > 0) {
      const wordStart = /[\s.\-]/.test(name[at - 1]);
      return { score: (wordStart ? 700 : 450) - name.length, ranges: [[at, at + lq.length]] };
    }
    // subsequence — "sdc" → set dutycycle
    const ranges = []; let i = 0;
    for (let j = 0; j < ln.length && i < lq.length; j++) {
      if (ln[j] === lq[i]) { ranges.push([j, j + 1]); i++; }
    }
    if (i === lq.length) return { score: 300 - name.length, ranges: mergeRanges(ranges) };
    if (cmd.desc.toLowerCase().includes(lq)) return { score: 120 - name.length, ranges: [] };
    return null;
  }
  function mergeRanges(r) {
    const out = [];
    for (const [a, b] of r) {
      const last = out[out.length - 1];
      if (last && last[1] === a) last[1] = b; else out.push([a, b]);
    }
    return out;
  }

  // ── Airtime ──────────────────────────────────────────────────────────
  // Rough round-trip cost. Frames are ~132 payload bytes; per-frame airtime
  // scales with spreading factor; every hop retransmits.
  const FRAME = 132;
  const PER_FRAME = { 9: 0.35, 10: 0.62, 11: 1.15, 12: 2.1 };
  function airtime(text, cmd, node) {
    const tx = Math.max(1, Math.ceil((text || '').length / FRAME));
    const rx = cmd ? cmd.rx : 1;
    const per = PER_FRAME[node.sf] || 1.15;
    const hops = Math.max(1, node.hops);
    const secs = (tx + rx) * per * hops * 0.55 + 0.4;
    return { tx, rx, secs, label: secs < 10 ? `~${secs.toFixed(1)} s` : `~${Math.round(secs)} s` };
  }

  // ── Parsing ──────────────────────────────────────────────────────────
  // Decides which suggestion surface the caret is currently in.
  function parse(text, caret) {
    const head = text.slice(0, caret == null ? text.length : caret);

    // {{ … — LiquidJS. Open when the last {{ has no matching }} after it.
    const open = head.lastIndexOf('{{');
    if (open !== -1 && head.indexOf('}}', open) === -1) {
      const inner = head.slice(open + 2);
      const pipe = inner.lastIndexOf('|');
      if (pipe !== -1) return { mode: 'filter', token: inner.slice(pipe + 1).trim(), start: open + 2 + pipe + 1 };
      return { mode: 'variable', token: inner.trim(), start: open + 2 };
    }

    // / — saved macros, only at the very start of the line.
    if (/^\/[^\s]*$/.test(head)) return { mode: 'macro', token: head.slice(1), start: 1 };

    // Otherwise: a command name, or arguments to one that already matched.
    // Longest matching command name wins ("set radio" over "set").
    let best = null;
    for (const c of D.commands) {
      if (head === c.name) best = pickLonger(best, { cmd: c, exact: true });
      else if (head.startsWith(c.name + ' ')) best = pickLonger(best, { cmd: c, exact: false });
    }
    if (best && !best.exact) {
      const rest = head.slice(best.cmd.name.length + 1);
      const parts = rest.split(/\s+/);
      return { mode: 'arg', cmd: best.cmd, argIndex: parts.length - 1, token: parts[parts.length - 1], start: head.length - parts[parts.length - 1].length };
    }
    return { mode: 'command', token: head, start: 0 };
  }
  function pickLonger(a, b) { return !a || b.cmd.name.length > a.cmd.name.length ? b : a; }

  // ── Suggestions ──────────────────────────────────────────────────────
  // One flat, already-ranked list; the palette groups it for display.
  function suggest(text, caret, opts) {
    const { auth = 'admin', unavailable = 'dim', recent = D.recent, node = D.node } = opts || {};
    const p = parse(text, caret);

    if (p.mode === 'variable') {
      const q = p.token.toLowerCase();
      return {
        p, kind: 'liquid',
        items: D.liquidVars.filter((v) => v.name.includes(q)).map((v) => ({
          id: 'v:' + v.name, label: v.name, meta: v.kind, desc: v.desc, sample: D.liquidCtx[v.name],
          insert: v.name + ' }}', replaceFrom: p.start, kindTag: 'variable',
        })),
      };
    }
    if (p.mode === 'filter') {
      const q = p.token.toLowerCase();
      return {
        p, kind: 'liquid',
        items: D.liquidFilters.filter((f) => f.name.includes(q)).map((f) => ({
          id: 'f:' + f.name, label: f.name, meta: f.custom ? 'meshcore' : 'liquid', desc: f.desc, sample: f.sig,
          insert: ' ' + f.sig + ' }}', replaceFrom: p.start, kindTag: 'filter',
        })),
      };
    }
    if (p.mode === 'macro') {
      const q = p.token.toLowerCase();
      return {
        p, kind: 'macro',
        items: D.macros.filter((m) => m.name.includes(q)).map((m) => ({
          id: 'm:' + m.name, label: m.name, meta: 'macro', desc: m.desc, sample: m.body,
          insert: m.body, replaceFrom: 0, replaceAll: true, kindTag: 'macro',
        })),
      };
    }
    if (p.mode === 'arg') {
      const cmd = p.cmd, spec = cmd.args && cmd.args[p.argIndex];
      const items = [];
      const q = (p.token || '').toLowerCase();
      if (spec && spec.enum) {
        for (const v of spec.enum) {
          if (q && !v.toLowerCase().startsWith(q)) continue;
          const isCurrent = spec.key && D.node[spec.key] === v;
          items.push({
            id: 'e:' + cmd.name + ':' + v, label: v, meta: isCurrent ? 'current' : '',
            desc: (spec.enumDesc && spec.enumDesc[v]) || spec.name, insert: v, replaceFrom: p.start, kindTag: 'value', current: isCurrent,
          });
        }
      }
      if (cmd.presets) {
        for (const pr of cmd.presets) {
          if (q && !pr.value.toLowerCase().startsWith(q) && !pr.label.toLowerCase().includes(q)) continue;
          items.push({ id: 'p:' + cmd.name + ':' + pr.value, label: pr.value, meta: pr.note || '', desc: pr.label, insert: pr.value, replaceFrom: p.start, kindTag: 'preset' });
        }
      }
      // The value the node last reported — the single most useful arg.
      if (cmd.key && D.node[cmd.key] && !items.some((i) => i.label === D.node[cmd.key])) {
        const cur = D.node[cmd.key];
        if (!q || cur.toLowerCase().startsWith(q)) {
          items.unshift({ id: 'c:' + cmd.name, label: cur, meta: 'on node now', desc: 'Last value reported by ' + D.node.name, insert: cur, replaceFrom: p.start, kindTag: 'current', current: true });
        }
      }
      return { p, kind: 'arg', cmd, spec, items };
    }

    // Command mode.
    const scored = [];
    for (const c of D.commands) {
      const m = match(p.token.trim(), c);
      if (!m) continue;
      const blocked = blockedReason(c, auth);
      if (blocked && unavailable === 'hide') continue;
      const rIdx = recent.indexOf(c.name);
      const score = m.score + (rIdx >= 0 ? 260 - rIdx * 10 : 0) - (blocked ? 2000 : 0);
      scored.push({
        id: 'c:' + c.name, label: c.name, cmd: c, ranges: m.ranges, score, blocked,
        desc: c.desc, group: c.group, insert: c.name + (c.spec || c.args ? ' ' : ''), replaceFrom: 0, replaceAll: true,
        kindTag: 'command', recent: rIdx >= 0 && !p.token,
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return { p, kind: 'command', items: scored };
  }

  // Longest common prefix of the top candidates — what Tab fills in.
  function commonPrefix(items) {
    if (!items.length) return null;
    let pre = items[0].label;
    for (const it of items) {
      let i = 0;
      while (i < pre.length && i < it.label.length && pre[i].toLowerCase() === it.label[i].toLowerCase()) i++;
      pre = pre.slice(0, i);
      if (!pre) return null;
    }
    return pre;
  }

  // ── Liquid ───────────────────────────────────────────────────────────
  // Enough of a renderer to show what actually goes on the air.
  function renderLiquid(text) {
    let unresolved = 0;
    const out = text.replace(/\{\{([^}]*)\}\}/g, (_, body) => {
      const name = body.trim().split('|')[0].trim();
      const v = D.liquidCtx[name];
      if (v == null) { unresolved++; return '{{' + body + '}}'; }
      const filters = body.split('|').slice(1).map((s) => s.trim());
      let val = v;
      for (const f of filters) {
        if (f.startsWith('upcase')) val = String(val).toUpperCase();
        if (f.startsWith('round')) val = String(Math.round(parseFloat(val) || 0));
        if (f.startsWith('truncate')) { const n = parseInt(f.split(':')[1], 10) || 24; val = String(val).slice(0, n); }
      }
      return String(val);
    });
    return { text: out, unresolved, hasTags: /\{\{/.test(text) };
  }

  // ── Mock repeater ────────────────────────────────────────────────────
  function resolve(text) {
    const t = text.trim();
    let best = null;
    for (const c of D.commands) {
      if (t === c.name || t.startsWith(c.name + ' ')) best = pickLonger(best, { cmd: c });
    }
    return best ? best.cmd : null;
  }

  function respond(text, node) {
    const cmd = resolve(text);
    const arg = cmd ? text.trim().slice(cmd.name.length).trim() : '';
    if (!cmd) return { ok: false, lines: ['Err - unknown command: ' + text.trim().split(' ')[0]] };
    if (cmd.serial) return { ok: false, lines: ['Err - serial only'] };

    switch (cmd.name) {
      case 'ver': return { ok: true, lines: [`${node.ver} (${node.board}) built 2026-05-18`] };
      case 'board': return { ok: true, lines: [node.board] };
      case 'clock': return { ok: true, lines: ['2026-07-27 19:32:11 UTC'] };
      case 'clock sync': return { ok: true, lines: ['OK - clock set, drift was +4s'] };
      case 'advert': return { ok: true, lines: ['OK - flood advert sent'] };
      case 'advert.zerohop': return { ok: true, lines: ['OK - zero-hop advert sent'] };
      case 'clear stats': return { ok: true, lines: ['OK - counters cleared'] };
      case 'log start': return { ok: true, lines: ['OK - rx capture started'] };
      case 'log stop': return { ok: true, lines: ['OK - rx capture stopped, 41.2 KB'] };
      case 'log erase': return { ok: true, lines: ['OK - log erased'] };
      case 'start ota': return { ok: true, lines: ['OK - entering OTA mode, node will disconnect'] };
      case 'neighbors': return {
        ok: true, lines: [
          'a9f1c2:1785206712:26', '2c44b8:1785206690:14', '82a3d0:1785206611:38',
          '7b21d0:1785206540:-6', 'c5e910:1785206388:22', 'a8c1f0:1785206201:31',
          '37bb04:1785205977:9', '1a3d3c:1785205812:44',
        ],
      };
      case 'discover.neighbors': return { ok: true, lines: ['OK - probe sent, 3 replies', 'a9f1c2 snr 9.5', '82a3d0 snr 6.0', '2c44b8 snr 3.5'] };
      case 'password': return { ok: true, lines: ['OK - admin password is now "' + (arg || '') + '"'] };
      case 'setperm': return { ok: true, lines: ['OK - acl updated'] };
      case 'region': return { ok: true, lines: ['* F', '  #NorthAmerica F', '    #USA F', '      #Texas'] };
      case 'gps sync': return { ok: true, lines: ['OK - clock synced from GPS'] };
      case 'gps setloc': return { ok: true, lines: [`OK - lat ${node.lat} lon ${node.lon}`] };
      default: break;
    }
    if (cmd.name.startsWith('get ') && cmd.key) return { ok: true, lines: [String(node[cmd.key])] };
    if (cmd.name.startsWith('set ') && cmd.key) {
      if (!arg) return { ok: false, lines: ['Err - missing value'] };
      node[cmd.key] = arg;
      return { ok: true, lines: ['OK' + (cmd.reboot ? ' - reboot required to apply' : '')] };
    }
    if (cmd.key) { if (arg) node[cmd.key] = arg; return { ok: true, lines: [String(node[cmd.key])] }; }
    return { ok: true, lines: ['OK'] };
  }

  return { byName, blockedReason, match, airtime, parse, suggest, commonPrefix, renderLiquid, resolve, respond, FRAME };
})();
