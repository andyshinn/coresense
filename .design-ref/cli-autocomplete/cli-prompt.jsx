// cli-prompt.jsx — the input line: ghost completion, Tab, shell history,
// Ctrl+R reverse-i-search, {{ }} expansion preview, destructive confirm.
const { Button: PButton } = window.CoreSenseUI;
const PrIcons = window.CLIIcons;
const PENG = window.CLI_ENGINE;

function HoldToSend({ label, onComplete }) {
  const [held, setHeld] = React.useState(false);
  const timer = React.useRef(null);
  const start = () => { setHeld(true); timer.current = setTimeout(() => { setHeld(false); onComplete(); }, 900); };
  const cancel = () => { setHeld(false); clearTimeout(timer.current); };
  React.useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <PButton variant="outline" size="sm" onMouseDown={start} onMouseUp={cancel} onMouseLeave={cancel} onTouchStart={start} onTouchEnd={cancel}
      className="cli-tint-danger relative shrink-0 overflow-hidden px-3 text-[12px] font-medium text-cs-danger" style={{ height: 28 }}>
      <span className="cli-bar-danger absolute inset-y-0 left-0" style={{ width: held ? '100%' : '0%', transition: held ? 'width 900ms linear' : 'width 120ms ease-out' }} />
      <span className="relative">{label}</span>
    </PButton>
  );
}

function ConfirmBar({ pending, onConfirm, onCancel }) {
  const cmd = pending.cmd;
  return (
    <div className="cli-tint-danger flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2">
      <PrIcons.Alert size={14} className="shrink-0 text-cs-danger" />
      <span className="text-[12px] leading-snug text-cs-text" style={{ textWrap: 'pretty', flex: '1 1 220px', minWidth: 0 }}>
        <span className="font-mono text-cs-danger">{pending.text}</span>
        <span className="text-cs-text-muted"> — {cmd && cmd.note ? cmd.note : 'This cannot be undone from here.'}</span>
        {cmd && cmd.noReply && <span className="text-cs-text-dim"> The node will not confirm.</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <HoldToSend label="Hold to send" onComplete={onConfirm} />
        <PButton size="sm" variant="ghost" className="text-[12px] text-cs-text-muted" style={{ height: 28 }} onClick={onCancel}>Cancel</PButton>
      </span>
    </div>
  );
}

// Bash-style reverse-i-search line.
function ReverseSearch({ query, match, index, total }) {
  const at = match ? match.text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  const glyph = { ok: ['✓', 'text-cs-online'], error: ['✕', 'text-cs-danger'], timeout: ['⧗', 'text-cs-danger'], noreply: ['·', 'text-cs-text-dim'] }[match ? match.status : 'ok'] || ['✓', 'text-cs-online'];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 overflow-hidden border-t border-cs-border bg-cs-bg-3 px-4 py-2">
      <span className="cli-t125 shrink-0 font-mono text-cs-accent">(reverse-i-search)`<span className="text-cs-text">{query}</span>':</span>
      {match ? (
        <span className="cli-t125 truncate font-mono text-cs-text" style={{ flex: '1 1 140px', minWidth: 120 }}>
          {at >= 0 ? (<>{match.text.slice(0, at)}<span className="bg-cs-accent-soft text-cs-accent">{match.text.slice(at, at + query.length)}</span>{match.text.slice(at + query.length)}</>) : match.text}
        </span>
      ) : (
        <span className="cli-t125 font-mono text-cs-danger" style={{ flex: '1 1 140px', minWidth: 120 }}>failing reverse-i-search</span>
      )}
      {match && <span className={`shrink-0 font-mono text-[12px] ${glyph[1]}`} title={match.status}>{glyph[0]}</span>}
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-cs-text-dim">{total ? index + 1 : 0}/{total}</span>
      <span className="flex min-w-0 shrink items-center gap-2 overflow-hidden text-[10px] text-cs-text-dim">
        <span className="whitespace-nowrap"><kbd className="cli-kbd">⌃R</kbd> older</span>
        <span className="whitespace-nowrap"><kbd className="cli-kbd">↵</kbd> run</span>
        <span className="whitespace-nowrap"><kbd className="cli-kbd">→</kbd> edit</span>
        <span className="whitespace-nowrap"><kbd className="cli-kbd">⌃G</kbd> abort</span>
      </span>
    </div>
  );
}

// "This is what actually goes on the air" — Liquid resolved, with the budget.
function ExpansionStrip({ raw }) {
  const r = PENG.renderLiquid(raw);
  if (!r.hasTags) return null;
  const bytes = new TextEncoder().encode(r.text).length;
  const over = bytes > PENG.FRAME;
  return (
    <div className="cli-strip flex items-center gap-2 border-t border-cs-border px-4 py-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-cs-text-dim">On air</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-cs-text">{r.text}</span>
      {r.unresolved > 0 && <Chip tone="danger">{r.unresolved} unresolved</Chip>}
      <span className={`shrink-0 font-mono text-[10px] tabular-nums ${over ? 'text-cs-danger' : 'text-cs-text-dim'}`}>{bytes}/{PENG.FRAME} B</span>
    </div>
  );
}

function Prompt({
  value, setValue, setCaret, inputRef, palette, onSubmit, onOpenPalette,
  paletteOpen, ghost, budget, queued, rsearch, confirmPending, onConfirm, onCancelConfirm, onKeyDown,
  rebootStrip, rebootPending, onRebootClick,
}) {
  return (
    <div className="relative border-t border-cs-border bg-cs-bg-2">
      {palette}
      {rebootStrip}
      {rsearch && <ReverseSearch {...rsearch} />}
      <ExpansionStrip raw={value} />
      {confirmPending && <ConfirmBar pending={confirmPending} onConfirm={onConfirm} onCancel={onCancelConfirm} />}
      <div className="flex items-center gap-2 px-4 py-2.5">
        {rebootPending && (
          <button onClick={onRebootClick} title="Settings are waiting for a reboot — show details"
            className="cli-tint-warn grid shrink-0 place-items-center rounded border text-cs-warn" style={{ width: 20, height: 20 }}>
            <PrIcons.Alert size={11} sw={2} />
          </button>
        )}
        <span className="shrink-0 font-mono text-[13px] text-cs-accent">$</span>
        <div className="cli-inputwrap relative min-w-0 flex-1 rounded-md border border-cs-border bg-cs-bg">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre font-mono text-[13px]" style={{ paddingLeft: 11 }}>
            <span style={{ visibility: 'hidden' }}>{value}</span>
            <span className="cli-ghost">{ghost}</span>
          </div>
          {/* Native input, not the DS <Input>: CoreSenseUI's Input is not
              forwardRef-wrapped, and this prompt needs a ref for focus and
              caret control (history recall, Tab completion, ghost accept).
              Styling is still token-driven. Worth fixing upstream. */}
          <input
            ref={inputRef} value={value} spellCheck={false} autoComplete="off" placeholder="repeater command"
            onChange={(e) => { setValue(e.target.value); setCaret(e.target.selectionStart); }}
            onKeyUp={(e) => setCaret(e.target.selectionStart)}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            className="cli-input relative w-full rounded-md bg-transparent px-2.5 font-mono text-[13px] text-cs-text outline-none placeholder:text-cs-text-dim"
            style={{ height: 34, border: 0 }}
          />
        </div>
        {budget && (
          <span className="flex shrink-0 items-center gap-1.5 font-mono tabular-nums text-cs-text-dim" style={{ fontSize: 10 }} title={`${budget.tx} frame(s) out, ${budget.rx} back — estimated round trip on this path`}>
            <PrIcons.Radio size={10} sw={1.8} />{budget.label}
          </span>
        )}
        {queued > 0 && <Chip tone="accent" title="Commands waiting for the radio">{queued} queued</Chip>}
        {!paletteOpen && (
          <PButton variant="outline" size="sm" onClick={onOpenPalette} className="shrink-0 px-1.5 text-[10px] text-cs-text-dim" style={{ height: 20 }} title="Show suggestions">⌃Space</PButton>
        )}
        <PButton size="sm" className="shrink-0 px-4 text-[12px]" style={{ height: 30 }} onClick={() => onSubmit()} disabled={!value.trim()}>Run</PButton>
      </div>
    </div>
  );
}

Object.assign(window, { Prompt, ConfirmBar, ReverseSearch, ExpansionStrip, HoldToSend });
