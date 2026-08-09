// cli-app.jsx — wiring. Owns the prompt state machine (history, reverse
// search, completion, confirmation) and the over-the-air send lifecycle.
const { TooltipProvider: ATooltipProvider, Toaster: AToaster, Button: AButton } = window.CoreSenseUI;
const AIcons = window.CLIIcons;
const AENG = window.CLI_ENGINE;
const AD = window.CLI_DATA;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "paletteLayout": "twopane",
  "openBehavior": "both",
  "ghostCompletion": true,
  "showAirtime": true,
  "pendingStyle": "dim",
  "showTimer": true,
  "timeoutSec": 12,
  "unavailable": "dim",
  "auth": "admin",
  "link": "normal",
  "rebootIndicator": "twotier"
}/*EDITMODE-END*/;

let uid = 0;
const nid = () => 'e' + (++uid);

function seedEntries() {
  const t = Date.now();
  return [
    { id: nid(), text: 'ver', sentAt: t - 41000, doneAt: t - 38600, state: 'ok', lines: ['v1.14.3 (RAK4631) built 2026-05-18'], frames: 1, snr: 6.5, est: { rx: 1, tx: 1, secs: 2.4, label: '~2.4 s' } },
    { id: nid(), text: 'get acl', sentAt: t - 30000, doneAt: t - 28900, state: 'error', lines: ['Err - serial only'], frames: 1, est: { rx: 1, tx: 1, secs: 1.1, label: '~1.1 s' } },
    { id: nid(), text: 'get radio', sentAt: t - 12000, doneAt: t - 9100, state: 'ok', lines: ['869.525,250,11,5'], frames: 1, snr: 5.0, followUp: [{ label: 'Change this value', text: 'set radio 869.525,250,11,5' }], est: { rx: 1, tx: 1, secs: 2.9, label: '~2.9 s' } },
  ];
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [tab, setTab] = React.useState('cli');
  const [value, setValue] = React.useState('');
  const [caret, setCaret] = React.useState(0);
  const [entries, setEntries] = React.useState(seedEntries);
  const [history, setHistory] = React.useState(() => AD.seedHistory.slice());
  const [histIdx, setHistIdx] = React.useState(-1);
  const [draft, setDraft] = React.useState('');
  const [manualOpen, setManualOpen] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [activeId, setActiveId] = React.useState('');
  const [navigated, setNavigated] = React.useState(false);
  const [rsearch, setRsearch] = React.useState(null);
  const [confirmPending, setConfirmPending] = React.useState(null);
  const [reboot, setReboot] = React.useState(() => loadPendingReboot(AD.node['public.key']));
  const [paletteWidth, setPaletteWidth] = React.useState(660);

  const inputRef = React.useRef(null);
  const anchorRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const timers = React.useRef({});
  const timeoutMs = t.timeoutSec * 1000;

  // A reboot-required write leaves config on the node that is not live yet. The
  // fact outlives dismissal, so it is stored per public key, not per session.
  React.useEffect(() => { savePendingReboot(AD.node['public.key'], reboot); }, [reboot]);
  const armReboot = (entry) => setReboot((r) => (
    r.settings.some((s) => s.label === entry.label)
      ? { ...r, dismissed: false }
      : { settings: [...r.settings, entry], dismissed: false, rebooting: false }
  ));
  const rebootArmed = reboot.settings.length > 0;
  const showStrip = rebootArmed && t.rebootIndicator !== 'quiet' && !reboot.dismissed;
  const showQuiet = rebootArmed && (t.rebootIndicator === 'quiet' || (t.rebootIndicator === 'twotier' && reboot.dismissed));

  const recent = React.useMemo(() => {
    const seen = [];
    for (const h of history.slice().reverse()) {
      const c = AENG.resolve(h.text || h);
      if (c && !seen.includes(c.name)) seen.push(c.name);
      if (seen.length >= 5) break;
    }
    return seen;
  }, [history]);

  const sug = React.useMemo(
    () => AENG.suggest(value, caret, { auth: t.auth, unavailable: t.unavailable, recent }),
    [value, caret, t.auth, t.unavailable, recent]
  );
  const items = sug.items;

  const typedOpen = t.openBehavior !== 'ctrlspace' && value.trim().length > 0 && !dismissed;
  const paletteOpen = (typedOpen || manualOpen) && items.length > 0 && !rsearch && !confirmPending && tab === 'cli';

  React.useEffect(() => {
    const measure = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Prefer a palette wide enough for the detail pane; let it overhang the
      // right rail on narrow windows rather than squeezing the command names.
      const max = Math.max(380, window.innerWidth - r.left - 20);
      setPaletteWidth(Math.round(Math.min(Math.max(r.width, 660), max)));
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [tab]);

  // Keep the highlighted row valid as the list changes.
  React.useEffect(() => {
    if (!items.length) { setActiveId(''); return; }
    if (!items.some((i) => i.id === activeId)) { setActiveId(items[0].id); setNavigated(false); }
  }, [items, activeId]);

  const ghost = React.useMemo(() => {
    if (!t.ghostCompletion || !value || caret !== value.length || !items.length) return '';
    const p = sug.p, top = items[0];
    if (p.mode === 'command' && top.label.toLowerCase().startsWith(value.toLowerCase())) return top.label.slice(value.length);
    if (p.mode === 'variable' && top.label.startsWith(p.token)) return top.label.slice(p.token.length) + ' }}';
    if (p.mode === 'arg' && top.label.toLowerCase().startsWith((p.token || '').toLowerCase())) return top.label.slice((p.token || '').length);
    return '';
  }, [t.ghostCompletion, value, caret, items, sug]);

  const budget = React.useMemo(() => {
    if (!value.trim()) return null;
    const cmd = AENG.resolve(AENG.renderLiquid(value).text);
    return AENG.airtime(value, cmd || { rx: 1 }, AD.node);
  }, [value]);

  const focus = () => requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
  const setLine = (next, moveCaret = true) => {
    setValue(next); setDismissed(false);
    if (moveCaret) { setCaret(next.length); requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(next.length, next.length); } }); }
  };

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, tab]);

  // ── Sending ──────────────────────────────────────────────────────────
  function send(text, opts = {}) {
    const raw = text;
    const rendered = AENG.renderLiquid(text);
    const finalText = rendered.text;
    const cmd = AENG.resolve(finalText);
    const blocked = cmd ? AENG.blockedReason(cmd, t.auth) : null;
    const est = AENG.airtime(finalText, cmd || { rx: 1 }, AD.node);
    const id = nid();
    const entry = { id, text: finalText, raw: raw !== finalText ? raw : null, sentAt: Date.now(), state: 'pending', est, cmdName: cmd ? cmd.name : null };
    setEntries((es) => [...es, entry]);
    if (!opts.silent) {
      setHistory((h) => [...h, { text: finalText, status: 'ok' }]);
      setHistIdx(-1);
    }

    if (cmd && cmd.noReply && !blocked) {
      timers.current[id] = setTimeout(() => patch(id, { state: 'noreply', doneAt: Date.now() }), 700);
      // A reboot is the one thing that applies pending config. It never replies,
      // so we clear on "heard again" rather than on an acknowledgement.
      if (cmd.name === 'reboot' || cmd.name === 'clkreboot') {
        setReboot((r) => ({ ...r, rebooting: true, dismissed: false }));
        timers.current[id + ':rb'] = setTimeout(() => setReboot({ settings: [], dismissed: false, rebooting: false }), 4500);
      }
      return;
    }

    // Gated commands fail fast — the node answers, but with a refusal.
    if (blocked) {
      timers.current[id] = setTimeout(() => patch(id, {
        state: 'error', doneAt: Date.now(), frames: 1,
        lines: [blocked.action === 'login' ? 'Err - permission denied' : 'Err - serial only'],
        followUp: blocked.action === 'login' ? [{ label: 'Requires admin', text: '__login' }] : null,
      }), Math.min(timeoutMs - 200, est.secs * 700));
      return;
    }

    const mult = t.link === 'slow' ? 2.6 : t.link === 'lossy' ? 1.4 : 1;
    const lost = t.link === 'lossy' && Math.random() < 0.4;
    const latency = est.secs * 1000 * mult * (0.75 + Math.random() * 0.5);

    if (lost || latency > timeoutMs) {
      timers.current[id] = setTimeout(() => {
        patch(id, { state: 'timeout', doneAt: Date.now() });
        setHistory((h) => h.map((x, i) => (i === h.length - 1 && x.text === finalText ? { ...x, status: 'timeout' } : x)));
      }, timeoutMs);
      return;
    }

    timers.current[id] = setTimeout(() => {
      const r = AENG.respond(finalText, AD.node);
      const follow = [];
      if (cmd) {
        if (cmd.name.startsWith('get ') && r.ok) {
          const setName = 'set ' + cmd.name.slice(4);
          if (AENG.byName[setName]) follow.push({ label: 'Change this value', text: setName + ' ' + r.lines[0] });
        }
        if (cmd.reboot) {
          follow.push({ label: 'Apply with', text: 'reboot' });
          if (r.ok) armReboot({ label: cmd.key || cmd.name.replace(/^set /, ''), verify: cmd.key ? 'get ' + cmd.key : null });
        }
      }
      patch(id, {
        state: r.ok ? 'ok' : 'error', doneAt: Date.now(), lines: r.lines,
        revealed: r.lines.length > 2 ? 1 : null, frames: Math.max(1, Math.ceil(r.lines.join('\n').length / AENG.FRAME)),
        snr: r.ok ? 3 + Math.random() * 6 : null, followUp: follow.length ? follow : null,
      });
      if (!r.ok) setHistory((h) => h.map((x, i) => (i === h.length - 1 && x.text === finalText ? { ...x, status: 'error' } : x)));
      if (r.lines.length > 2) stream(id, r.lines.length);
    }, latency);
  }

  function stream(id, total) {
    let n = 1;
    const iv = setInterval(() => {
      n++;
      patch(id, { revealed: n });
      if (n >= total) { clearInterval(iv); patch(id, { revealed: null }); }
    }, 260);
    timers.current[id + ':s'] = iv;
  }

  function patch(id, fields) {
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...fields } : e)));
  }

  React.useEffect(() => () => Object.values(timers.current).forEach((x) => { clearTimeout(x); clearInterval(x); }), []);

  function submit(text) {
    const line = (text != null ? text : value).trim();
    if (!line) return;
    const cmd = AENG.resolve(AENG.renderLiquid(line).text);
    const blocked = cmd ? AENG.blockedReason(cmd, t.auth) : null;
    if (cmd && cmd.danger && !blocked) { setConfirmPending({ text: line, cmd }); setManualOpen(false); setDismissed(true); return; }
    send(line);
    setLine('');
    setManualOpen(false);
  }

  function applyItem(it) {
    let next;
    if (it.replaceAll) next = it.insert;
    else next = value.slice(0, it.replaceFrom) + it.insert + value.slice(caret);
    setLine(next);
    setNavigated(false);
    if (it.kindTag === 'command' && !it.insert.endsWith(' ')) setManualOpen(false);
  }

  function move(delta) {
    if (!items.length) return;
    const i = Math.max(0, items.findIndex((x) => x.id === activeId));
    const n = (i + delta + items.length) % items.length;
    setActiveId(items[n].id);
    setNavigated(true);
  }

  // ── Reverse-i-search ─────────────────────────────────────────────────
  function rsMatches(q) {
    if (!q) return history.slice().reverse();
    return history.slice().reverse().filter((h) => h.text.toLowerCase().includes(q.toLowerCase()));
  }
  function openRSearch() {
    setRsearch({ query: '', index: 0, restore: value, match: history[history.length - 1] || null, total: history.length });
    setManualOpen(false);
  }
  function updateRSearch(query, index) {
    setRsearch((r) => {
      if (!r) return r;
      const q = query != null ? query : r.query;
      const m = rsMatches(q);
      const i = Math.min(Math.max(0, index != null ? index : r.index), Math.max(0, m.length - 1));
      return { ...r, query: q, index: i, match: m[i] || null, total: m.length };
    });
  }
  function closeRSearch(accept, run) {
    const r = rsearch;
    setRsearch(null);
    if (accept && r && r.match) { setLine(r.match.text); if (run) { submit(r.match.text); } }
    else if (r) setLine(r.restore);
    focus();
  }

  // ── Keyboard ─────────────────────────────────────────────────────────
  function onKeyDown(e) {
    const k = e.key;
    if (rsearch) {
      if (e.ctrlKey && (k === 'r' || k === 'R')) { e.preventDefault(); updateRSearch(null, rsearch.index + 1); return; }
      if (e.ctrlKey && (k === 'g' || k === 'G')) { e.preventDefault(); closeRSearch(false); return; }
      if (k === 'Escape') { e.preventDefault(); closeRSearch(false); return; }
      if (k === 'Enter') { e.preventDefault(); closeRSearch(true, true); return; }
      if (k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); closeRSearch(true, false); return; }
      if (k === 'Backspace') { e.preventDefault(); setRsearch((r) => { const q = r.query.slice(0, -1); const m = rsMatches(q); return { ...r, query: q, index: 0, match: m[0] || null, total: m.length }; }); return; }
      if (k.length === 1 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setRsearch((r) => { const q = r.query + k; const m = rsMatches(q); return { ...r, query: q, index: 0, match: m[0] || null, total: m.length }; }); return; }
      e.preventDefault();
      return;
    }
    if (e.ctrlKey && (k === 'r' || k === 'R')) { e.preventDefault(); openRSearch(); return; }
    if (e.ctrlKey && k === ' ') { e.preventDefault(); setManualOpen((o) => !o); setDismissed(false); return; }
    if (e.ctrlKey && (k === 'l' || k === 'L')) { e.preventDefault(); setEntries([]); return; }

    if (k === 'ArrowUp') {
      if (paletteOpen) { e.preventDefault(); move(-1); return; }
      e.preventDefault();
      const i = histIdx < 0 ? history.length - 1 : histIdx - 1;
      if (i < 0) return;
      if (histIdx < 0) setDraft(value);
      setHistIdx(i); setLine(history[i].text); setDismissed(true);
      return;
    }
    if (k === 'ArrowDown') {
      if (paletteOpen) { e.preventDefault(); move(1); return; }
      if (histIdx < 0) return;
      e.preventDefault();
      const i = histIdx + 1;
      if (i >= history.length) { setHistIdx(-1); setLine(draft); return; }
      setHistIdx(i); setLine(history[i].text);
      return;
    }
    if (k === 'Tab') {
      e.preventDefault();
      if (!paletteOpen) { setManualOpen(true); setDismissed(false); return; }
      if (items.length === 1) { applyItem(items[0]); return; }
      const active = items.find((x) => x.id === activeId);
      if (navigated && active) { applyItem(active); return; }
      const pre = AENG.commonPrefix(items);
      const tok = sug.p.mode === 'command' ? value : sug.p.token;
      if (pre && pre.length > tok.length) {
        const next = sug.p.mode === 'command' ? pre : value.slice(0, sug.p.start) + pre + value.slice(caret);
        setLine(next);
      } else setNavigated(true);
      return;
    }
    if ((k === 'ArrowRight' || k === 'End') && ghost && caret === value.length) { e.preventDefault(); setLine(value + ghost); return; }
    if (k === 'Enter') {
      e.preventDefault();
      const active = items.find((x) => x.id === activeId);
      if (paletteOpen && navigated && active) { applyItem(active); return; }
      submit();
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      if (confirmPending) { setConfirmPending(null); return; }
      if (paletteOpen) { setManualOpen(false); setDismissed(true); return; }
      setLine('');
      return;
    }
  }

  const node = AD.node;

  return (
    <ATooltipProvider delayDuration={300}>
      <div className="flex h-full w-full flex-col bg-cs-bg text-cs-text">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <LeftNav />
          <main className="flex min-w-0 flex-1 flex-col bg-cs-bg">
            <RepeaterHeader node={node} tab={tab} onTab={setTab}
              badge={showQuiet ? <RebootHeaderChip pending={reboot} onClick={() => { setTab('cli'); setReboot((r) => ({ ...r, dismissed: false })); }} /> : null}
              tabBadges={showQuiet ? { cli: <RebootTabDot /> } : null} />
            {tab === 'cli' ? (
              <>
                <Transcript
                  entries={entries} style={t.pendingStyle} showTimer={t.showTimer} timeoutMs={timeoutMs}
                  scrollRef={scrollRef}
                  onRetry={(en) => send(en.text, { silent: true })}
                  onEdit={(text) => (text === '__login' ? setTab('login') : setLine(text))}
                />
                <Prompt
                  value={value} setValue={(v) => { setValue(v); setDismissed(false); setHistIdx(-1); setNavigated(false); }}
                  setCaret={setCaret} inputRef={inputRef}
                  palette={(
                    <Palette
                      open={paletteOpen} anchorRef={anchorRef} result={sug} activeId={activeId}
                      setActiveId={(v) => setActiveId(v)} layout={t.paletteLayout} showAirtime={t.showAirtime}
                      auth={t.auth} unavailable={t.unavailable} width={paletteWidth}
                      onPick={applyItem} onLogin={() => { setTab('login'); setManualOpen(false); }}
                    />
                  )}
                  rebootPending={rebootArmed}
                  onRebootClick={() => setReboot((r) => ({ ...r, dismissed: !r.dismissed }))}
                  rebootStrip={showStrip ? (
                    <RebootStrip
                      pending={reboot}
                      onReboot={() => submit('reboot')}
                      onDismiss={() => setReboot((r) => ({ ...r, dismissed: true }))}
                      onVerify={(cmdText) => submit(cmdText)}
                    />
                  ) : null}
                  onSubmit={submit} onOpenPalette={() => { setManualOpen(true); setDismissed(false); focus(); }}
                  paletteOpen={paletteOpen} ghost={ghost} budget={budget}
                  queued={Math.max(0, entries.filter((e) => e.state === 'pending').length - 1)}
                  rsearch={rsearch} confirmPending={confirmPending}
                  onConfirm={() => { send(confirmPending.text); setConfirmPending(null); setLine(''); }}
                  onCancelConfirm={() => { setConfirmPending(null); focus(); }}
                  onKeyDown={onKeyDown}
                />
              </>
            ) : (
              <TabPlaceholder tab={tab} onGoCli={() => { setTab('cli'); focus(); }} />
            )}
            <StatusBar extra={
              <span className="flex items-center gap-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">SF{node.sf} · {node.hops} hops</span>
                <button className="text-[10px] uppercase tracking-wider text-cs-text-dim hover:text-cs-text-muted" onClick={() => setEntries([])}>clear ⌃L</button>
              </span>
            } />
          </main>
          <ContactRail node={node} pending={reboot} onPendingClick={() => { setTab('cli'); setReboot((r) => ({ ...r, dismissed: false })); }} />
        </div>
        <AToaster />

        <TweaksPanel>
          <TweakSection label="Autocomplete" />
          <TweakSelect label="Detail surface" value={t.paletteLayout}
            options={[{ value: 'twopane', label: 'Two-pane detail' }, { value: 'inline', label: 'Inline description' }, { value: 'compact', label: 'Compact + hover card' }]}
            onChange={(v) => setTweak('paletteLayout', v)} />
          <TweakRadio label="Opens on" value={t.openBehavior} options={['typing', 'ctrlspace', 'both']} onChange={(v) => setTweak('openBehavior', v)} />
          <TweakToggle label="Ghost completion" value={t.ghostCompletion} onChange={(v) => setTweak('ghostCompletion', v)} />
          <TweakToggle label="Airtime estimates" value={t.showAirtime} onChange={(v) => setTweak('showAirtime', v)} />
          <TweakRadio label="Unavailable cmds" value={t.unavailable} options={['dim', 'group', 'hide']} onChange={(v) => setTweak('unavailable', v)} />
          <TweakRadio label="Session" value={t.auth} options={['admin', 'guest']} onChange={(v) => setTweak('auth', v)} />

          <TweakSection label="In-flight" />
          <TweakSelect label="Pending style" value={t.pendingStyle}
            options={[{ value: 'dim', label: 'Dimmed echo + cursor' }, { value: 'gutter', label: 'SENT → ACK → REPLY' }, { value: 'skeleton', label: 'Skeleton reply block' }, { value: 'bar', label: 'Airtime progress bar' }]}
            onChange={(v) => setTweak('pendingStyle', v)} />
          <TweakToggle label="Elapsed timer (ms)" value={t.showTimer} onChange={(v) => setTweak('showTimer', v)} />
          <TweakSlider label="Reply timeout" value={t.timeoutSec} min={3} max={30} step={1} unit="s" onChange={(v) => setTweak('timeoutSec', v)} />
          <TweakRadio label="Link" value={t.link} options={['normal', 'slow', 'lossy']} onChange={(v) => setTweak('link', v)} />
          <TweakSelect label="Reboot indicator" value={t.rebootIndicator}
            options={[{ value: 'twotier', label: 'Two-tier — strip, demotes on dismiss' }, { value: 'strip', label: 'Strip only — × hides it' }, { value: 'quiet', label: 'Quiet signals only' }]}
            onChange={(v) => setTweak('rebootIndicator', v)} />

          <TweakSection label="Try it" />
          <TweakButton label="Run set radio (needs reboot)" onClick={() => submit('set radio 910.525,250,11,5')} />
          <TweakButton label="Run neighbors" onClick={() => submit('neighbors')} />
          <TweakButton label="Run erase (destructive)" onClick={() => submit('erase')} />
          <TweakButton label="Clear transcript" onClick={() => setEntries([])} />
        </TweaksPanel>
      </div>
    </ATooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
