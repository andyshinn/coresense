type DividerTone = 'accent' | 'date';

// Tone → { label text color, rule-line background }. Centralizes the two
// palettes so the unread delimiter and the date separator share one layout.
const TONE_CLASSES: Record<DividerTone, { label: string; line: string }> = {
  accent: { label: 'text-cs-accent', line: 'bg-cs-accent/40' },
  date: { label: 'text-cs-text-muted', line: 'bg-cs-border' },
};

// A labeled horizontal rule: two thin lines flanking a centered, uppercase,
// letter-spaced label. Used for the unread "New" delimiter and per-day date
// separators in the message list.
export function MessageDivider({ label, tone }: { label: string; tone: DividerTone }) {
  const c = TONE_CLASSES[tone];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider ${c.label}`}>
      <span className={`h-px flex-1 ${c.line}`} />
      <span>{label}</span>
      <span className={`h-px flex-1 ${c.line}`} />
    </div>
  );
}
