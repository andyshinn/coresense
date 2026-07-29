// cli-palette.jsx — the suggestion surface. A cmdk Command list inside a
// Popover anchored to the prompt, with three detail-surface variations:
//   compact  — one line per row, docs in a HoverCard
//   inline   — description folds out under the highlighted row
//   twopane  — persistent detail pane, follows keyboard navigation
const { Command: DSCommand, CommandList: DSCommandList, CommandGroup: DSCommandGroup, CommandItem: DSCommandItem, CommandEmpty: DSCommandEmpty, Popover: DSPopover, PopoverAnchor: DSPopoverAnchor, PopoverContent: DSPopoverContent, HoverCard: DSHoverCard, HoverCardTrigger: DSHoverCardTrigger, HoverCardContent: DSHoverCardContent, Kbd: DSKbd } = window.CoreSenseUI;
const PIcons = window.CLIIcons;
const ENG = window.CLI_ENGINE;

const DETAIL_W = 250;
const DETAIL_MIN = 560; // below this the two-pane detail folds away

const CHIP_TONE = {
  danger: 'cli-tint-danger text-cs-danger',
  warn: 'cli-tint-warn text-cs-warn',
  accent: 'border-cs-accent/30 bg-cs-accent-soft text-cs-accent',
  mute: 'border-cs-border-strong bg-cs-bg-3 text-cs-text-dim',
  info: 'border-cs-border-strong bg-cs-bg-3 text-cs-text-muted',
};

function Chip({ tone = 'mute', children, title }) {
  return <span title={title} className={`shrink-0 rounded-sm border px-1 font-mono uppercase tracking-wider ${CHIP_TONE[tone]}`} style={{ fontSize: 9, lineHeight: '15px' }}>{children}</span>;
}

// The over-the-air facts, as chips. Order matters: blockers first.
function cmdChips(cmd, opts = {}) {
  const out = [];
  if (!cmd) return out;
  if (cmd.serial) out.push({ tone: 'mute', text: 'serial only', title: 'Never answered over the air — wired console only' });
  if (cmd.admin && opts.auth !== 'admin') out.push({ tone: 'warn', text: 'admin', title: 'Requires an admin session' });
  if (cmd.danger) out.push({ tone: 'danger', text: 'destructive', title: 'Asks for confirmation before sending' });
  if (cmd.noReply) out.push({ tone: 'info', text: 'no reply', title: 'The node never answers this — nothing to wait for' });
  if (cmd.reboot) out.push({ tone: 'accent', text: 'reboot', title: 'Takes effect only after a reboot' });
  if (cmd.fw) out.push({ tone: 'info', text: 'v' + cmd.fw + '+', title: 'Needs firmware ' + cmd.fw + ' or newer' });
  if (cmd.deprecated) out.push({ tone: 'mute', text: 'deprecated', title: 'Deprecated as of firmware ' + cmd.deprecated });
  if (cmd.experimental) out.push({ tone: 'mute', text: 'exp', title: 'Experimental' });
  return out;
}

function Highlight({ text, ranges }) {
  if (!ranges || !ranges.length) return <>{text}</>;
  const out = []; let i = 0;
  ranges.forEach(([a, b], k) => {
    if (a > i) out.push(<span key={'p' + k}>{text.slice(i, a)}</span>);
    out.push(<span key={'m' + k} className="text-cs-accent">{text.slice(a, b)}</span>);
    i = b;
  });
  if (i < text.length) out.push(<span key="t">{text.slice(i)}</span>);
  return <>{out}</>;
}

function Airtime({ est }) {
  return (
    <span className="flex shrink-0 items-center gap-1 font-mono tabular-nums text-cs-text-dim" style={{ fontSize: 10 }} title={`${est.tx} frame${est.tx > 1 ? 's' : ''} out · ${est.rx} back · estimated round trip`}>
      <PIcons.Radio size={10} sw={1.8} />{est.label}
    </span>
  );
}

// ── Detail body, shared by the two-pane and hover-card surfaces ────────
function CmdDetail({ cmd, est, blocked }) {
  if (!cmd) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="font-mono text-[13px] text-cs-text">{cmd.name}{cmd.spec ? <span className="text-cs-text-dim"> {cmd.spec}</span> : null}</div>
        <p className="mt-1 text-[12px] leading-snug text-cs-text-muted" style={{ textWrap: 'pretty' }}>{cmd.desc}</p>
      </div>
      {blocked && <div className="cli-tint-warn rounded border px-2 py-1.5 text-[11px] leading-snug text-cs-warn">{blocked.why}</div>}
      {cmd.args && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wider text-cs-text-dim">Parameters</div>
          {cmd.args.map((a) => (
            <div key={a.name} className="flex items-baseline gap-2 text-[11px]">
              <span className="shrink-0 font-mono text-cs-text">{a.name}</span>
              <span className="text-cs-text-dim" style={{ textWrap: 'pretty' }}>{a.enum ? a.enum.join(' | ') : a.hint}</span>
            </div>
          ))}
        </div>
      )}
      {cmd.def && (
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Default</span>
          <span className="font-mono tabular-nums text-cs-text-muted">{cmd.def}</span>
        </div>
      )}
      {cmd.key && window.CLI_DATA.node[cmd.key] != null && String(window.CLI_DATA.node[cmd.key]).length > 0 && (
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">On node</span>
          <span className="truncate font-mono tabular-nums text-cs-text">{String(window.CLI_DATA.node[cmd.key])}</span>
        </div>
      )}
      {est && (
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Round trip</span>
          <span className="font-mono tabular-nums text-cs-text-muted">{cmd.noReply ? `${est.tx}↑ · no reply` : `${est.tx}↑ ${est.rx}↓ · ${est.label}`}</span>
        </div>
      )}
      {cmd.note && <p className="border-t border-cs-border pt-2 text-[11px] leading-snug text-cs-text-dim" style={{ textWrap: 'pretty' }}>{cmd.note}</p>}
    </div>
  );
}

// ── Rows ───────────────────────────────────────────────────────────────
function CommandRow({ item, layout, selected, showAirtime, auth, onPick, onLogin }) {
  const cmd = item.cmd;
  const est = cmd ? ENG.airtime(item.label, cmd, window.CLI_DATA.node) : null;
  const chips = cmdChips(cmd, { auth });
  const dim = !!item.blocked;
  const row = (
    <DSCommandItem
      value={item.id}
      onSelect={() => (item.blocked && item.blocked.action === 'login' ? onLogin() : onPick(item))}
      className={`flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 ${dim ? 'opacity-50' : ''}`}
    >
      <span className={`mt-0.5 shrink-0 ${selected ? 'text-cs-accent' : 'text-cs-text-dim'}`}>
        {item.recent ? <PIcons.Clock size={11} /> : cmd && cmd.danger ? <PIcons.Alert size={11} className="text-cs-danger" /> : <PIcons.Terminal size={11} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="cli-t125 shrink-0 whitespace-nowrap font-mono text-cs-text"><Highlight text={item.label} ranges={item.ranges} /></span>
          {cmd && cmd.spec && <span className="truncate font-mono text-[11px] text-cs-text-dim">{cmd.spec}</span>}
        </span>
        {layout === 'inline' && selected && (
          <span className="mt-0.5 block text-[11px] leading-snug text-cs-text" style={{ textWrap: 'pretty' }}>
            {item.blocked ? item.blocked.why : item.desc}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {chips.map((c) => <Chip key={c.text} tone={c.tone} title={c.title}>{c.text}</Chip>)}
        {showAirtime && est && cmd && !cmd.noReply && (selected || est.rx >= 2) && <Airtime est={est} />}
      </span>
    </DSCommandItem>
  );
  if (layout !== 'compact' || !cmd) return row;
  return (
    <DSHoverCard openDelay={200} closeDelay={60}>
      <DSHoverCardTrigger asChild>{row}</DSHoverCardTrigger>
      <DSHoverCardContent side="right" align="start" sideOffset={12} className="w-72 border-cs-border-strong bg-cs-bg-2 p-3">
        <CmdDetail cmd={cmd} est={est} blocked={item.blocked} />
      </DSHoverCardContent>
    </DSHoverCard>
  );
}

function ValueRow({ item, selected, onPick }) {
  return (
    <DSCommandItem value={item.id} onSelect={() => onPick(item)}
      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5">
      <span className={`shrink-0 ${selected ? 'text-cs-accent' : 'text-cs-text-dim'}`}>
        {item.kindTag === 'variable' ? <PIcons.Braces size={11} /> : item.kindTag === 'filter' ? <PIcons.Bolt size={11} /> : item.kindTag === 'macro' ? <PIcons.Bolt size={11} /> : item.current ? <PIcons.Check size={11} /> : <PIcons.Reply size={11} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="cli-t125 block truncate font-mono text-cs-text">{item.label}</span>
        <span className="block truncate text-[11px] leading-snug text-cs-text-dim">{item.desc}</span>
      </span>
      {item.sample && <span className="shrink-0 truncate font-mono text-[11px] text-cs-text-muted" style={{ maxWidth: '38%' }}>{item.sample}</span>}
      {item.meta && <Chip tone={item.current ? 'accent' : 'mute'}>{item.meta}</Chip>}
    </DSCommandItem>
  );
}

// ── Palette ────────────────────────────────────────────────────────────
function Palette({ open, anchorRef, result, activeId, setActiveId, layout, showAirtime, auth, unavailable, onPick, onLogin, width }) {
  const items = result.items;
  const active = items.find((i) => i.id === activeId) || items[0];
  const isCommandMode = result.kind === 'command';
  const twopane = layout === 'twopane' && width >= DETAIL_MIN;
  const effLayout = layout === 'twopane' && !twopane ? 'inline' : layout;

  const groups = React.useMemo(() => {
    if (!isCommandMode) return [{ name: null, items }];
    const recents = items.filter((i) => i.recent);
    const rest = items.filter((i) => !i.recent);
    const avail = rest.filter((i) => !i.blocked);
    const blocked = rest.filter((i) => i.blocked);
    const out = [];
    if (recents.length) out.push({ name: 'Recent on this node', items: recents });
    const byGroup = new Map();
    for (const i of avail) {
      if (!byGroup.has(i.group)) byGroup.set(i.group, []);
      byGroup.get(i.group).push(i);
    }
    for (const [name, list] of byGroup) out.push({ name, items: list });
    if (blocked.length) out.push({ name: 'Not available over radio', items: blocked });
    return out;
  }, [items, isCommandMode]);

  const header = { command: 'Commands', arg: 'Values', liquid: 'Liquid', macro: 'Macros' }[result.kind] || 'Commands';
  const subhead = result.kind === 'arg' && result.spec ? result.spec.name
    : result.p.mode === 'filter' ? 'filter' : result.p.mode === 'variable' ? 'variable' : null;

  return (
    <DSPopover open={open}>
      <DSPopoverAnchor asChild><div ref={anchorRef} className="pointer-events-none absolute top-0" style={{ left: 16, right: 16, height: 1 }} /></DSPopoverAnchor>
      <DSPopoverContent
        side="top" align="start" sideOffset={8} avoidCollisions={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        className="overflow-hidden border-cs-border-strong bg-cs-bg-2 p-0 shadow-2xl"
        style={{ width }}
      >
        <DSCommand shouldFilter={false} value={active ? active.id : ''} onValueChange={setActiveId} loop className="bg-transparent">
          <div className="flex items-center gap-2 border-b border-cs-border px-2.5 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-cs-text-dim">{header}</span>
            {subhead && <span className="font-mono text-[10px] text-cs-accent">{subhead}</span>}
            <span className="font-mono text-[10px] tabular-nums text-cs-text-dim">{items.length}</span>
            <span className="flex-1" />
            <span className="flex items-center gap-2.5 text-[10px] text-cs-text-dim">
              <span><kbd className="cli-kbd">↹</kbd> complete</span>
              <span><kbd className="cli-kbd">↑↓</kbd> move</span>
              <span><kbd className="cli-kbd">↵</kbd> run</span>
              <span><kbd className="cli-kbd">esc</kbd> dismiss</span>
            </span>
          </div>
          <div className="flex">
            <DSCommandList className="min-w-0 flex-1 p-1" style={{ maxHeight: 302 }}>
              <DSCommandEmpty className="px-3 py-6 text-center text-[12px] text-cs-text-dim">No command matches — press ↵ to send it raw.</DSCommandEmpty>
              {groups.map((g, gi) => (
                <DSCommandGroup key={g.name || gi} heading={g.name || undefined}>
                  {g.items.map((item) => (
                    isCommandMode
                      ? <CommandRow key={item.id} item={item} layout={effLayout} selected={!!active && active.id === item.id} showAirtime={showAirtime} auth={auth} onPick={onPick} onLogin={onLogin} />
                      : <ValueRow key={item.id} item={item} selected={!!active && active.id === item.id} onPick={onPick} />
                  ))}
                </DSCommandGroup>
              ))}
            </DSCommandList>
            {twopane && (
              <div className="cli-pane-sunk shrink-0 border-l border-cs-border p-3" style={{ width: DETAIL_W, maxHeight: 302, overflowY: 'auto' }}>
                {active && active.cmd
                  ? <CmdDetail cmd={active.cmd} est={ENG.airtime(active.label, active.cmd, window.CLI_DATA.node)} blocked={active.blocked} />
                  : active
                    ? (
                      <div className="flex flex-col gap-2">
                        <div className="font-mono text-[13px] text-cs-text">{active.label}</div>
                        <p className="text-[12px] leading-snug text-cs-text-muted" style={{ textWrap: 'pretty' }}>{active.desc}</p>
                        {active.sample && (
                          <div className="rounded border border-cs-border bg-cs-bg px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-cs-text-dim">Resolves to</div>
                            <div className="mt-0.5 break-all font-mono text-[12px] text-cs-accent">{active.sample}</div>
                          </div>
                        )}
                      </div>
                    )
                    : <div className="text-[12px] text-cs-text-dim">Nothing selected.</div>}
              </div>
            )}
          </div>
        </DSCommand>
      </DSPopoverContent>
    </DSPopover>
  );
}

Object.assign(window, { Palette, Chip, cmdChips, CmdDetail, Airtime, Highlight });
