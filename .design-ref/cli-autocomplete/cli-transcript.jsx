// cli-transcript.jsx — the log. A command over the air is not a shell command:
// it may take seconds, arrive in pieces, or never come back at all. Four
// treatments for that wait are selectable as a tweak.
const { Skeleton: TSkeleton, Button: TButton } = window.CoreSenseUI;
const TIcons = window.CLIIcons;

function useTick(active, ms = 47) {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => force((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

function MsCounter({ from, done }) {
  useTick(done == null);
  const ms = (done != null ? done : Date.now()) - from;
  return <span className="font-mono text-[11px] tabular-nums text-cs-text-dim">{ms.toLocaleString('en-US')} ms</span>;
}

// ── The four in-flight treatments ──────────────────────────────────────
function PendingAffordance({ entry, style, showTimer }) {
  useTick(true, 60);
  const waited = Date.now() - entry.sentAt;
  const expected = Math.max(600, entry.est.secs * 1000);
  const pct = Math.min(100, (waited / expected) * 100);
  const phase = waited < expected * 0.35 ? 'SENT' : waited < expected * 0.9 ? 'ACK' : 'AWAITING REPLY';

  if (style === 'gutter') {
    return (
      <span className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-cs-accent">{phase}</span>
        {showTimer && <MsCounter from={entry.sentAt} />}
      </span>
    );
  }
  if (style === 'bar') {
    return (
      <span className="flex items-center gap-2">
        <span className="block overflow-hidden rounded-full bg-cs-bg-3" style={{ width: 84, height: 3 }}>
          <span className="block h-full bg-cs-accent" style={{ width: pct + '%', transition: 'width 120ms linear' }} />
        </span>
        {showTimer && <MsCounter from={entry.sentAt} />}
      </span>
    );
  }
  if (style === 'skeleton') return showTimer ? <MsCounter from={entry.sentAt} /> : null;
  return (
    <span className="flex items-center gap-2">
      <span className="cli-blink inline-block bg-cs-accent" style={{ width: 7, height: 12 }} />
      {showTimer && <MsCounter from={entry.sentAt} />}
    </span>
  );
}

function ReplyMeta({ entry }) {
  const bits = [];
  if (entry.frames) bits.push(`${entry.frames} frame${entry.frames > 1 ? 's' : ''}`);
  if (entry.doneAt) bits.push(`${((entry.doneAt - entry.sentAt) / 1000).toFixed(2)} s`);
  if (entry.snr) bits.push(`SNR ${entry.snr > 0 ? '+' : ''}${entry.snr.toFixed(1)} dB`);
  if (!bits.length) return null;
  return <div className="pl-5 pt-0.5 font-mono text-[10px] text-cs-text-dim">{bits.join(' · ')}</div>;
}

function TranscriptEntry({ entry, style, showTimer, timeoutMs, onRetry, onEdit }) {
  const pending = entry.state === 'pending';
  const failed = entry.state === 'timeout';
  const shown = entry.lines ? entry.lines.slice(0, entry.revealed == null ? entry.lines.length : entry.revealed) : [];
  const streaming = entry.lines && entry.revealed != null && entry.revealed < entry.lines.length;

  return (
    <div className={`px-4 py-1.5 ${pending && style === 'dim' ? 'opacity-50' : ''}`}>
      {entry.raw && (
        <div className="flex items-baseline gap-2 pl-5 text-[11px]">
          <span className="font-mono text-cs-text-dim">{entry.raw}</span>
          <span className="text-cs-text-dim">→ expanded</span>
        </div>
      )}
      <div className="flex items-baseline gap-2">
        <span className={`cli-t125 shrink-0 font-mono ${failed ? 'cli-danger-soft' : 'text-cs-accent'}`}>$</span>
        <span className={`cli-t125 min-w-0 flex-1 break-all font-mono ${failed ? 'cli-danger-soft' : 'text-cs-text'}`}>{entry.text}</span>
        {pending
          ? <PendingAffordance entry={entry} style={style} showTimer={showTimer} />
          : entry.state === 'noreply'
            ? <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-cs-text-dim">sent · no reply expected</span>
            : showTimer && entry.doneAt ? <MsCounter from={entry.sentAt} done={entry.doneAt} /> : null}
      </div>

      {pending && style === 'skeleton' && (
        <div className="flex flex-col gap-1 pl-5 pt-1.5">
          {Array.from({ length: Math.min(3, entry.est.rx || 1) }).map((_, i) => (
            <TSkeleton key={i} className="rounded-sm bg-cs-bg-3" style={{ height: 11, width: [190, 124, 152][i] }} />
          ))}
        </div>
      )}

      {shown.length > 0 && (
        <div className="pl-5 pt-0.5">
          {shown.map((l, i) => (
            <div key={i} className={`cli-t125 cli-lead15 whitespace-pre-wrap break-all font-mono ${/^err/i.test(l) ? 'text-cs-danger' : 'text-cs-text-muted'}`}>{l}</div>
          ))}
          {streaming && <div className="font-mono text-[10px] uppercase tracking-wider text-cs-accent">receiving {entry.revealed}/{entry.lines.length}…</div>}
        </div>
      )}

      {failed && (
        <div className="flex flex-wrap items-center gap-2 pl-5 pt-1">
          <span className="cli-danger-soft font-mono text-[11px]">no reply after {(timeoutMs / 1000).toFixed(0)} s</span>
          <TButton size="sm" variant="outline" className="cli-tint-danger h-5 gap-1 px-1.5 text-[10px] text-cs-danger" onClick={() => onRetry(entry)}>
            <TIcons.Refresh size={10} />Retry
          </TButton>
          <button className="text-[10px] text-cs-text-dim underline-offset-2 hover:text-cs-text-muted hover:underline" onClick={() => onEdit(entry.text)}>edit and resend</button>
        </div>
      )}

      {entry.state === 'ok' && !streaming && <ReplyMeta entry={entry} />}

      {(entry.state === 'ok' || entry.state === 'error') && entry.followUp && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-5 pt-1.5">
          {entry.followUp.map((f) => (
            <span key={f.text} className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">{f.label}</span>
              <TButton variant="outline" size="sm" onClick={() => onEdit(f.text)}
                className="h-auto border-cs-border bg-cs-bg-3 px-1.5 py-0.5 font-mono text-[11px] font-normal text-cs-text-muted hover:border-cs-accent/40 hover:text-cs-accent">{f.text === '__login' ? 'Log in as admin →' : f.text}</TButton>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptEmpty() {
  return (
    <div className="px-4 py-4">
      <p className="text-[13px] text-cs-text-dim" style={{ textWrap: 'pretty' }}>
        Type a repeater CLI command (e.g. <code className="rounded bg-cs-bg-3 px-1 py-0.5 font-mono text-[12px] text-cs-text-muted">get radio</code>, <code className="rounded bg-cs-bg-3 px-1 py-0.5 font-mono text-[12px] text-cs-text-muted">discover.neighbors</code>).
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-cs-text-dim">
        <span><kbd className="cli-kbd">⌃Space</kbd> suggestions</span>
        <span><kbd className="cli-kbd">↹</kbd> complete</span>
        <span><kbd className="cli-kbd">↑</kbd> previous</span>
        <span><kbd className="cli-kbd">⌃R</kbd> reverse search</span>
        <span><kbd className="cli-kbd">{'{{'}</kbd> variables</span>
        <span><kbd className="cli-kbd">/</kbd> macros</span>
        <span><kbd className="cli-kbd">⌃L</kbd> clear</span>
      </div>
    </div>
  );
}

function Transcript({ entries, style, showTimer, timeoutMs, onRetry, onEdit, scrollRef }) {
  return (
    <div ref={scrollRef} className="cli-scroll min-h-0 flex-1 overflow-y-auto py-2">
      {entries.length === 0 && <TranscriptEmpty />}
      {entries.map((e) => (
        <TranscriptEntry key={e.id} entry={e} style={style} showTimer={showTimer} timeoutMs={timeoutMs} onRetry={onRetry} onEdit={onEdit} />
      ))}
    </div>
  );
}

Object.assign(window, { Transcript, TranscriptEntry, TranscriptEmpty });
