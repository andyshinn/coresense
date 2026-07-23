// qb-concepts.jsx — Quick Bar toolbar + message-pane demo (the chosen direction).
// Depends on window.MA (shared parts), window.MA_DATA, window.MA_ICONS.
// Exposes window.QB.{ QuickBar, MessagePaneDemo }
(function () {
  const { useState, useEffect, useRef } = React;
  const { Button, Separator, toast } = window.CoreSenseUI;
  const I = window.MA_ICONS;
  const {
    cx, TipBtn, PopTipBtn, MessageRow, Composer,
    EmojiPickerPanel, MacroPanel, InfoPanel, MoreList, ReactionRow,
  } = window.MA;

  // Floating container: fades in on hover, stays while a popover is pinned open.
  function RailShell({ show, children }) {
    return (
      <div style={{
        position: 'absolute', display: 'flex', alignItems: 'center', zIndex: 20,
        right: 12, top: -14,
        opacity: show ? 1 : 0, pointerEvents: show ? 'auto' : 'none',
        transform: `translateY(${show ? 0 : 3}px)`,
        transition: 'opacity .12s ease, transform .12s ease',
      }}>{children}</div>
    );
  }

  function Pill({ children, className }) {
    return (
      <div className={cx('flex items-center gap-1 rounded-lg border border-cs-border-strong bg-cs-bg-3 p-1 px-1.5', className)}
        style={{ boxShadow: '0 10px 26px rgba(0,0,0,0.5)' }}>
        {children}
      </div>
    );
  }

  function MacroChip({ label, onClick }) {
    return (
      <button type="button" onClick={onClick}
        className="inline-flex items-center gap-1 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1 text-[11px] font-medium text-cs-text-muted transition-colors hover:border-cs-accent/40 hover:text-cs-text">
        <span className="text-cs-accent"><I.bolt size={11} /></span>{label}
      </button>
    );
  }

  // ── Quick Bar ───────────────────────────────────────────────────────
  // Others: [5 quick emoji + picker] | Reply | [macro chips + all-macros] | copy | more
  // Self:   [Copy] [Info] [Delete]
  function QuickBar({ m, isSelf, ctx, visible, onPin }) {
    const [open, setOpen] = useState(null);
    useEffect(() => { onPin(!!open); }, [open]);
    const show = visible || !!open;
    const P = (key) => ({ open: open === key, onOpenChange: (o) => setOpen(o ? key : null) });
    const D = window.MA_DATA;

    const moreItems = [
      { key: 'key', icon: <I.key size={15} />, label: 'Copy public key', run: () => ctx.copyKey(m) },
      { sep: true },
      { key: 'fwd', icon: <I.forward size={15} />, label: 'Forward', soon: true },
      { key: 'pin', icon: <I.pin size={15} />, label: 'Pin message', soon: true },
      { sep: true },
      { key: 'del', icon: <I.trash size={15} />, label: 'Dismiss locally', kind: 'destructive', run: () => ctx.del(m) },
    ];

    return (
      <RailShell show={show}>
        <Pill>
          {!isSelf ? (
            <>
              {/* reactions: quick row + expandable picker */}
              <div className="flex items-center gap-0.5">
                <ReactionRow count={5} onPick={(e) => ctx.react(m, e)} size="icon-xs" />
                <PopTipBtn tip="More emoji" size="icon-xs" {...P('emoji')}
                  content={<EmojiPickerPanel onPick={(e) => { ctx.react(m, e); setOpen(null); }} />}>
                  <I.plus size={14} />
                </PopTipBtn>
              </div>
              <Separator orientation="vertical" className="mx-1 h-6 bg-cs-border" />
              {/* primary: labelled reply */}
              <Button variant="secondary" size="sm" className="h-7 gap-1.5 px-2.5 text-[12px]" onClick={() => ctx.reply(m)}>
                <I.reply size={14} /> Reply
              </Button>
              {/* macros: inline chips + all-macros popover */}
              <div className="flex items-center gap-1 pl-1">
                {D.macros.slice(0, 2).map((mac) => (
                  <MacroChip key={mac.label} label={mac.label} onClick={() => ctx.macro(m, mac)} />
                ))}
                <PopTipBtn tip="All macros" size="icon-xs" {...P('macro')}
                  content={<MacroPanel onPick={(mac) => { ctx.macro(m, mac); setOpen(null); }} />}>
                  <I.more size={14} />
                </PopTipBtn>
              </div>
              <Separator orientation="vertical" className="mx-1 h-6 bg-cs-border" />
              {/* utilities + overflow */}
              <TipBtn tip="Copy text" onClick={() => ctx.copyText(m)}><I.copy size={16} /></TipBtn>
              <PopTipBtn tip="More" {...P('more')} content={<MoreList items={moreItems} onClose={() => setOpen(null)} />}>
                <I.more size={16} />
              </PopTipBtn>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" className="h-7 gap-1.5 px-2.5 text-[12px]" onClick={() => ctx.copyText(m)}>
                <I.copy size={14} /> Copy
              </Button>
              <PopTipBtn tip="Info" {...P('info')} content={<InfoPanel m={m} />}><I.info size={16} /></PopTipBtn>
              <TipBtn tip="Delete" className="text-cs-danger hover:bg-cs-danger/10 hover:text-cs-danger" onClick={() => ctx.del(m)}>
                <I.trash size={16} />
              </TipBtn>
            </>
          )}
        </Pill>
      </RailShell>
    );
  }

  // ── Message-pane demo shell ─────────────────────────────────────────
  function MessagePaneDemo({ Toolbar }) {
    const D = window.MA_DATA;
    const [value, setValue] = useState('');
    const [replyingTo, setReplyingTo] = useState(null);
    const [hoverId, setHoverId] = useState(null);
    const [pinId, setPinId] = useState(null);
    const inputRef = useRef(null);
    const focus = () => requestAnimationFrame(() => inputRef.current && inputRef.current.focus());

    const ctx = {
      reply: (m) => { setReplyingTo(m); setValue((v) => (v.startsWith('@' + m.mention) ? v : `@${m.mention} `)); focus(); },
      react: (m, e) => { setReplyingTo(m); setValue(`@${m.mention} ${e} `); focus(); },
      macro: (m, mac) => { setReplyingTo(m); setValue(`@${m.mention} ${mac.text} `); focus(); },
      copyText: (m) => { try { navigator.clipboard.writeText(m.body); } catch (e) {} toast.success('Copied message text'); },
      copyKey: (m) => { try { navigator.clipboard.writeText(m.pk); } catch (e) {} toast.success('Copied public key'); },
      del: (m) => { toast('Message dismissed locally', { description: 'Removed from this device only.' }); },
    };

    return (
      <div className="flex flex-col overflow-hidden rounded-xl border border-cs-border bg-cs-bg"
        style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.02) inset' }}>
        <div className="flex items-center gap-2 border-b border-cs-border px-4 py-2.5">
          <span className="font-mono text-cs-accent">#</span>
          <span className="text-[13px] font-semibold text-cs-text">meshcore</span>
          <span className="font-mono text-[10px] text-cs-text-dim">· hashtag · open · key 2fa78a5a</span>
          <div className="flex-1" />
          <span className="font-mono text-[10px] text-cs-text-dim">⌘K</span>
        </div>
        <div className="py-2">
          {D.messages.map((m) => {
            const isSelf = m.role === 'self';
            const visible = hoverId === m.id || pinId === m.id;
            return (
              <MessageRow
                key={m.id} m={m} visible={visible}
                onHover={(on) => setHoverId(on ? m.id : (h) => (h === m.id ? null : h))}
                toolbar={
                  <Toolbar m={m} isSelf={isSelf} ctx={ctx} visible={visible}
                    onPin={(on) => setPinId(on ? m.id : (p) => (p === m.id ? null : p))} />
                }
              />
            );
          })}
        </div>
        <Composer
          value={value} onChange={setValue} channel="#meshcore"
          replyingTo={replyingTo} onClearReply={() => { setReplyingTo(null); setValue(''); }}
          inputRef={inputRef}
        />
      </div>
    );
  }

  window.QB = { QuickBar, MessagePaneDemo };
})();
