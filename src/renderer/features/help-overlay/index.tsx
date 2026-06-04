import { Keyboard, X } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { SHORTCUTS, type ShortcutCategory } from '../../../shared/shortcuts';
import { toAccelerator, toCaps } from '../../../shared/shortcuts-format';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog';
import { Kbd, KbdGroup } from '../../components/ui/kbd';
import { osLabel, rendererPlatform } from '../../lib/shortcut-selectors';
import { useStore } from '../../lib/store';

const CATEGORY_ORDER: ShortcutCategory[] = ['General', 'Navigation', 'Messages', 'Radio'];

const PLATFORM = rendererPlatform();
const OS_LABEL = osLabel();
const ROW_GRID = 'grid grid-cols-[170px_132px_1fr] gap-[14px]';

export function ShortcutsHelpDialog() {
  const open = useStore((s) => s.helpOpen);
  const closeHelp = useStore((s) => s.closeHelp);

  // Group the registry by category, preserving registry order within each.
  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: SHORTCUTS.filter((s) => s.category === category),
    })).filter((g) => g.items.length > 0);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeHelp();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="help-overlay"
        className="flex max-h-[calc(100%-2rem)] w-[640px] max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-[7px] border border-cs-border-strong bg-cs-bg-2 p-0 text-cs-text shadow-[0_28px_70px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.4)]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-3 border-b border-cs-border px-[18px] pt-[15px] pb-[13px]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[9px]">
              <Keyboard size={14} className="text-cs-accent" />
              <DialogTitle className="text-[14px] font-semibold tracking-[0.1px] text-cs-text">
                Keyboard Shortcuts
              </DialogTitle>
            </div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.3px] text-cs-text-dim">
              MeshCore Desktop · {OS_LABEL}
            </div>
            <DialogDescription className="sr-only">
              A reference list of every keyboard shortcut, grouped by category.
            </DialogDescription>
          </div>
          <DialogClose
            className="-mt-px flex size-6 shrink-0 items-center justify-center rounded border border-cs-border bg-cs-bg-3 text-cs-text-muted hover:text-cs-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cs-accent"
            aria-label="Close"
          >
            <X size={11} />
          </DialogClose>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto pb-2.5">
          {/* Sticky column header */}
          <div
            className={`${ROW_GRID} sticky top-0 z-10 border-b border-cs-border bg-cs-bg-2 px-[18px] py-[9px] font-mono text-[9px] tracking-[0.6px] text-cs-text-dim`}
          >
            <span>ACTION</span>
            <span>KEYS</span>
            <span>DESCRIPTION</span>
          </div>
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="bg-cs-bg px-[18px] pt-2 pb-[5px] font-mono text-[9.5px] tracking-[0.8px] text-cs-accent-soft uppercase">
                {group.category}
              </div>
              {group.items.map((s) => (
                <div
                  key={s.id}
                  className={`${ROW_GRID} items-center border-b border-cs-bg-3 px-[18px] py-[7px]`}
                >
                  <span className="text-[12px] font-medium text-cs-text">{s.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {s.chords.map((chord, ci) => (
                      <Fragment key={toAccelerator(chord)}>
                        {ci > 0 && (
                          <span className="font-mono text-[10px] text-cs-text-dim">or</span>
                        )}
                        <KbdGroup>
                          {toCaps(chord, PLATFORM).map((cap) => (
                            <Kbd key={cap}>{cap}</Kbd>
                          ))}
                        </KbdGroup>
                      </Fragment>
                    ))}
                  </span>
                  <span className="text-[11px] leading-[1.4] text-cs-text-muted">{s.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center gap-[7px] border-t border-cs-border bg-cs-bg px-[18px] py-2.5 text-[11.5px] text-cs-text-dim">
          <span>Press</span>
          <Kbd>?</Kbd>
          <span>anytime to open this dialog.</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
