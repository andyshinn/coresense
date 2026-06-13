import { useStore } from '../lib/store';
import { cn } from '../lib/utils';

// "On this page" jump list for the Settings panel, rendered inside the
// RightRail details pane. Highlights the scroll-spied section, shows a dirty
// dot per unsaved section, and scrolls the panel on click.
export function SettingsJumpRail() {
  const activeTab = useStore((s) => s.settingsUi.activeTab);
  const sections = useStore((s) => s.settingsUi.sections);
  const dirtyById = useStore((s) => s.settingsUi.dirtyById);
  const activeSectionId = useStore((s) => s.settingsUi.activeSectionId);
  const requestScrollToSection = useStore((s) => s.requestScrollToSection);

  const tabSections = sections.filter((s) => s.tab === activeTab);
  if (tabSections.length === 0) {
    return <p className="italic text-cs-text-dim">no sections</p>;
  }

  return (
    <nav aria-label="Jump to settings section" className="flex flex-col gap-0.5">
      {tabSections.map((s) => {
        const on = s.id === activeSectionId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => requestScrollToSection(s.id)}
            className={cn(
              'flex items-center gap-2 border-l-2 py-1 pr-1 pl-2.5 text-left text-[12px] transition-colors',
              on
                ? 'border-cs-accent font-semibold text-cs-text'
                : 'border-transparent text-cs-text-muted hover:text-cs-text',
            )}
          >
            <span className="flex-1 truncate">{s.title}</span>
            {dirtyById[s.id] && <span className="size-1.5 shrink-0 rounded-full bg-cs-warn" aria-hidden />}
          </button>
        );
      })}
    </nav>
  );
}
