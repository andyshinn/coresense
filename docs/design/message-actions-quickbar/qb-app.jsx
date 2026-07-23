// qb-app.jsx — focused presentation of the Quick Bar direction.
(function () {
  const { TooltipProvider, Toaster } = window.CoreSenseUI;
  const I = window.MA_ICONS;
  const { cx } = window.MA;
  const { QuickBar, MessagePaneDemo } = window.QB;

  function AxisTag({ label, value }) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-cs-border bg-cs-bg-2 px-2 py-1">
        <span className="text-[9.5px] uppercase tracking-wider text-cs-text-dim">{label}</span>
        <span className="text-[11.5px] font-medium text-cs-text">{value}</span>
      </div>
    );
  }

  function Rule({ icon, title, children }) {
    return (
      <div className="flex gap-3 rounded-lg border border-cs-border bg-cs-bg-2 p-3">
        <span className="mt-0.5 text-cs-accent">{icon}</span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-cs-text">{title}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-cs-text-muted">{children}</div>
        </div>
      </div>
    );
  }

  function App() {
    return (
      <div className="mx-auto max-w-[980px] px-6 py-12 sm:px-10">
        <header className="mb-8">
          <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-cs-text-dim">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-cs-online" style={{ boxShadow: '0 0 8px var(--color-cs-online)' }} />
            MeshCore · Message pane
          </div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-cs-text">Message actions — Quick Bar</h1>
          <p className="mt-3 max-w-[680px] text-[14px] leading-relaxed text-cs-text-muted">
            Hover a message to reveal the action bar at its corner. Quick emojis and the picker compose a
            mention reply in the composer; macro chips insert saved text; everything past the primary set
            collapses into <span className="font-mono text-cs-text">⋯</span>.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <AxisTag label="Density" value="Roomy, labelled" />
            <AxisTag label="Reactions" value="5-wide row → picker" />
            <AxisTag label="Macros" value="Inline chips" />
            <AxisTag label="Anchor" value="Message corner" />
          </div>
        </header>

        <MessagePaneDemo Toolbar={QuickBar} />

        <div className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Rule icon={<I.smiley size={16} />} title="Hover to reveal">
            The bar fades in at the corner and stays put while a popover is open.
          </Rule>
          <Rule icon={<I.reply size={16} />} title="Emoji → @mention reply">
            Reactions and the full picker both drop a mention reply into the composer — no reaction packet.
          </Rule>
          <Rule icon={<I.copy size={16} />} title="Yours vs others’">
            Your own messages (row 3) swap the reply/react set for Copy · Info · Delete.
          </Rule>
          <Rule icon={<I.more size={16} />} title="Overflow-ready">
            Copy public key, Forward, Pin and Delete live under ⋯ — add buttons without a redesign.
          </Rule>
        </div>

        <footer className="mt-8 border-t border-cs-border pt-5 text-[11px] leading-relaxed text-cs-text-dim">
          Interactive reference · Macros, Forward and Pin are tagged “soon” · reactions land in the composer as mention replies · not wired to real send/delete.
        </footer>
      </div>
    );
  }

  function Root() {
    return (
      <TooltipProvider delayDuration={150} skipDelayDuration={300}>
        <App />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
})();
