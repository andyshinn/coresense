import { Kbd, KbdGroup } from 'coresense';

// Dark "Field Console" surface — keyboard hints render against the app's own
// near-black background, like the command palette footer and help overlay.
function Surface({ children }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-cs-bg p-6 text-cs-text">{children}</div>
  );
}

export function SingleKeys() {
  return (
    <Surface>
      <Kbd>?</Kbd>
      <Kbd>esc</Kbd>
      <Kbd>↵</Kbd>
      <Kbd>↑↓</Kbd>
    </Surface>
  );
}

export function Chords() {
  return (
    <Surface>
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>F</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>⇧</Kbd>
        <Kbd>P</Kbd>
      </KbdGroup>
    </Surface>
  );
}

export function ShortcutRows() {
  return (
    <Surface>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-6">
          <span className="text-[12px] text-cs-text">Open command palette</span>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-[12px] text-cs-text">Find a contact</span>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>F</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-[12px] text-cs-text">Rescan for radios</span>
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>R</Kbd>
          </KbdGroup>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span className="text-[12px] text-cs-text">Toggle this help</span>
          <Kbd>?</Kbd>
        </div>
      </div>
    </Surface>
  );
}

export function PaletteFooter() {
  return (
    <Surface>
      <div className="flex items-center gap-3 text-[10px] text-cs-text-dim">
        <span className="flex items-center gap-1.5">
          <Kbd>↑↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> run
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </Surface>
  );
}
