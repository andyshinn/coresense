// ma-shared.jsx — shared pieces for all three concepts.
// Exposes window.MA.{ Avatar, MessageRow, Composer, EmojiPickerPanel,
//   MacroPanel, InfoPanel, MoreList, TipBtn, PopTipBtn, ReactionRow }
(function () {
  const {
    Button, Badge, Separator, KeyValueRow, buttonVariants,
    Tooltip, TooltipTrigger, TooltipContent,
    Popover, PopoverTrigger, PopoverContent,
    Command, CommandInput, CommandList, CommandItem, CommandEmpty,
  } = window.CoreSenseUI;
  const I = window.MA_ICONS;
  const cx = (...a) => a.filter(Boolean).join(' ');

  // ── Icon button + tooltip ──────────────────────────────────────────
  // NOTE: the DS <Button> is a plain function component (no forwardRef), so it
  // cannot be a Radix asChild trigger. We render a native <button> with the DS
  // buttonVariants() classes instead — host elements take refs natively.
  function TipBtn({ tip, side = 'top', children, className, size = 'icon-sm', variant = 'ghost', ...rest }) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className={cx(buttonVariants({ variant, size }), className)} {...rest}>{children}</button>
        </TooltipTrigger>
        <TooltipContent side={side}>{tip}</TooltipContent>
      </Tooltip>
    );
  }

  // Popover trigger with a native title label (single asChild → native button,
  // so Radix can anchor without a forwardRef seam).
  function PopTipBtn({
    tip, children, content, open, onOpenChange,
    side = 'top', align = 'end', sideOffset = 8, contentClass,
    size = 'icon-sm', variant = 'ghost', className,
  }) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" title={tip} aria-label={tip}
            className={cx(buttonVariants({ variant, size }), className)}>{children}</button>
        </PopoverTrigger>
        <PopoverContent side={side} align={align} sideOffset={sideOffset}
          className={cx('p-0 border-cs-border-strong bg-cs-bg-2', contentClass)}>
          {content}
        </PopoverContent>
      </Popover>
    );
  }

  // ── Avatar ─────────────────────────────────────────────────────────
  function Avatar({ m, size = 34 }) {
    const isEmoji = /\p{Extended_Pictographic}/u.test(m.avatar.glyph);
    const bg = `hsl(${m.avatar.hue} 45% 22%)`;
    const fg = `hsl(${m.avatar.hue} 70% 72%)`;
    return (
      <div className="shrink-0 rounded-md flex items-center justify-center font-semibold select-none"
        style={{
          width: size, height: size, background: bg, color: fg,
          fontSize: isEmoji ? size * 0.52 : size * 0.36,
          border: `1px solid hsl(${m.avatar.hue} 45% 30%)`,
        }}>
        {m.avatar.glyph}
      </div>
    );
  }

  function StateTag({ m }) {
    const map = {
      acked:   ['ack',   'text-cs-online'],
      relayed: ['relay', 'text-cs-warn'],
      sending: ['tx…',   'text-cs-warn'],
    };
    const t = map[m.state]; if (!t) return null;
    return <span className={cx('font-mono text-[10px]', t[1])}>{t[0]}</span>;
  }

  function SignalMeta({ m }) {
    return (
      <div className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-cs-text-dim tabular-nums">
        <span>{m.time}</span>
        <span className="text-cs-border-strong">·</span>
        <span>{m.ago}</span>
        {m.role !== 'self' && (
          <>
            <span className="text-cs-border-strong">·</span>
            <span>{m.hops}h</span>
            <span className="text-cs-border-strong">·</span>
            <span>{m.snr > 0 ? '+' : ''}{m.snr}dB</span>
          </>
        )}
      </div>
    );
  }

  // ── Message row (bubble + avatar). `toolbar` is positioned by the concept. ──
  function MessageRow({ m, visible, onHover, toolbar, dense }) {
    const isSelf = m.role === 'self';
    return (
      <div
        className="group relative flex gap-3 px-4 py-2 transition-colors"
        style={{ background: visible ? 'var(--color-cs-bg-2)' : 'transparent' }}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <Avatar m={m} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cx('text-[13px] font-semibold', isSelf ? 'text-cs-accent' : 'text-cs-text')}>{m.from}</span>
            <StateTag m={m} />
          </div>
          <div
            className="mt-1 inline-block max-w-full rounded-lg px-3 py-1.5 text-[13px] leading-relaxed text-cs-text"
            style={{
              background: 'var(--color-cs-bg-3)',
              borderLeft: isSelf ? '2px solid var(--color-cs-accent)' : '2px solid transparent',
            }}
          >
            {m.body}
          </div>
          <SignalMeta m={m} />
        </div>
        {toolbar}
      </div>
    );
  }

  // ── Emoji picker panel (search + grid) — sits inside a Popover. ──────
  function EmojiPickerPanel({ onPick, showFrequent = true }) {
    const D = window.MA_DATA;
    return (
      <div style={{ width: 258 }}>
        <Command className="bg-transparent">
          <div className="px-2 pt-2">
            <CommandInput placeholder="Search emoji…" className="h-8" />
          </div>
          <CommandList className="max-h-[214px] px-1.5 pb-1.5 pt-1">
            <CommandEmpty className="py-6 text-center text-[12px] text-cs-text-dim">No emoji found</CommandEmpty>
            {showFrequent && (
              <div className="px-1 pb-1 pt-1 text-[10px] uppercase tracking-wider text-cs-text-dim">Frequently used</div>
            )}
            <div className="grid grid-cols-7 gap-0.5">
              {D.emojis.map(({ e, k }) => (
                <CommandItem
                  key={e} value={e + ' ' + k} onSelect={() => onPick(e)}
                  className="flex h-8 cursor-pointer items-center justify-center rounded-md text-[18px] data-[selected=true]:bg-cs-accent-soft"
                >
                  {e}
                </CommandItem>
              ))}
            </div>
          </CommandList>
        </Command>
        <div className="border-t border-cs-border px-3 py-2 text-[10.5px] leading-snug text-cs-text-dim">
          Adds <span className="font-mono text-cs-text-muted">@mention</span> + emoji to your reply — no separate reaction packet.
        </div>
      </div>
    );
  }

  // ── Macro panel (roadmap) ───────────────────────────────────────────
  function MacroPanel({ onPick, width = 244 }) {
    const D = window.MA_DATA;
    return (
      <div style={{ width }} className="p-1.5">
        <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Reply macros</span>
          <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-medium text-cs-text-dim">soon</Badge>
        </div>
        <div className="flex flex-col gap-0.5">
          {D.macros.map((mac) => (
            <button key={mac.label} onClick={() => onPick(mac)}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-cs-bg-3">
              <span className="text-cs-accent"><I.bolt size={14} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-cs-text">{mac.label}</span>
                <span className="block truncate font-mono text-[11px] text-cs-text-dim">{mac.text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Message info panel ──────────────────────────────────────────────
  function InfoPanel({ m }) {
    return (
      <div style={{ width: 288 }} className="p-3">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-cs-text-dim">Message info</span>
        </div>
        <div className="mb-3 rounded-md border border-cs-border bg-cs-bg-3 px-2.5 py-2 text-[12px] leading-relaxed text-cs-text">
          {m.body}
        </div>
        <div className="rounded-md border border-cs-border bg-cs-bg-3/40">
          <KeyValueRow label="From" value={m.from} />
          <KeyValueRow label="Public key" value={m.pk} mono />
          <KeyValueRow label="Hops" value={`${m.hops}`} mono />
          {m.role !== 'self' && <KeyValueRow label="RSSI / SNR" value={`${m.rssi} dBm · ${m.snr > 0 ? '+' : ''}${m.snr} dB`} mono />}
          <KeyValueRow label="State" value={m.state} mono />
        </div>
        {m.path.length > 0 && (
          <>
            <div className="mb-1.5 mt-3 text-[10px] uppercase tracking-wider text-cs-text-dim">Path</div>
            <div className="flex flex-col gap-1">
              {m.path.map((h, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-cs-border bg-cs-bg-3 px-2 py-1.5">
                  <span className="font-mono text-[10px] text-cs-text-dim">{i + 1}</span>
                  <span className="flex-1 truncate font-mono text-[11px] text-cs-text">{h}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Generic vertical action list (for "more" / command menus) ───────
  function MoreList({ items, onClose, width = 216 }) {
    return (
      <div style={{ width }} className="p-1">
        {items.map((it, i) =>
          it.sep ? (
            <Separator key={'s' + i} className="my-1 bg-cs-border" />
          ) : (
            <button
              key={it.key}
              disabled={it.soon}
              onClick={() => { if (!it.soon) { it.run && it.run(); onClose && onClose(); } }}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
                it.soon ? 'cursor-default opacity-45' : 'hover:bg-cs-bg-3',
                it.kind === 'destructive' ? 'text-cs-danger hover:bg-cs-danger/10' : 'text-cs-text',
              )}
            >
              <span className={it.kind === 'destructive' ? 'text-cs-danger' : 'text-cs-text-muted'}>{it.icon}</span>
              <span className="flex-1">{it.label}</span>
              {it.soon && <Badge variant="outline" className="h-4 px-1.5 text-[9px] text-cs-text-dim">soon</Badge>}
              {it.hint && <span className="font-mono text-[10px] text-cs-text-dim">{it.hint}</span>}
            </button>
          )
        )}
      </div>
    );
  }

  // ── Inline reaction row (frequent emojis) ───────────────────────────
  function ReactionRow({ onPick, count, size = 'icon-sm' }) {
    const D = window.MA_DATA;
    return D.frequent.slice(0, count).map((e) => (
      <Tooltip key={e}>
        <TooltipTrigger asChild>
          <button type="button" className={cx(buttonVariants({ variant: 'ghost', size }), 'text-[16px] leading-none')} onClick={() => onPick(e)}>
            <span>{e}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Reply with {e}</TooltipContent>
      </Tooltip>
    ));
  }

  // ── Composer (bottom bar) with reply context chip ───────────────────
  function Composer({ value, onChange, replyingTo, onClearReply, inputRef, channel }) {
    return (
      <div className="border-t border-cs-border px-4 py-3">
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-cs-accent-soft px-2 py-1 text-[11px] text-cs-accent">
              <I.reply size={12} />
              Replying to <span className="font-semibold">@{replyingTo.mention}</span>
            </span>
            <button onClick={onClearReply} className="text-cs-text-dim hover:text-cs-text" aria-label="Cancel reply">
              <I.plus size={13} style={{ transform: 'rotate(45deg)' }} />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2.5 rounded-md border border-cs-border bg-cs-bg-2 px-3 py-2">
          <span className="font-mono text-cs-accent">›</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={`Message ${channel}…`}
            className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-cs-text outline-none placeholder:text-cs-text-dim"
          />
          <span className="shrink-0 font-mono text-[10px] text-cs-text-dim tabular-nums">{value.length}/200 · ETA 1.4s</span>
        </div>
      </div>
    );
  }

  window.MA = {
    cx, TipBtn, PopTipBtn, Avatar, MessageRow, Composer,
    EmojiPickerPanel, MacroPanel, InfoPanel, MoreList, ReactionRow,
  };
})();
