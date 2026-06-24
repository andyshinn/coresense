# Task 3.5 Report — SettingsPanel chrome to Radix layout

## Files changed
- `src/renderer/panels/settings/SettingsPanel.tsx` — main conversion
- `src/renderer/panels/settings/PillTabs.tsx` — icon type widened

## Observer / scroll ref preservation
The `scrollRef = useRef<HTMLDivElement>(null)` is attached to a `<Box overflow="auto">` (a Radix Box that renders a real `<div>`). This was chosen deliberately over `<ScrollArea>` because Radix ScrollArea hides the scrollable node behind an internal viewport wrapper, which would break:
1. The `IntersectionObserver` `root` option — the observer is constructed with `{ root, rootMargin: '0px 0px -70% 0px', threshold: 0 }` where `root = scrollRef.current`. If `scrollRef.current` pointed to the ScrollArea outer element rather than the viewport, the root would not be the scrolling container and all intersection calculations would be wrong.
2. The smooth-scroll jump-rail — `scrollRef.current?.querySelector('[data-section="…"]')` followed by `el?.scrollIntoView(…)` needs the element found to be a descendant of the actual scroll container.

By using `<Box overflow="auto" ref={scrollRef}>`, the ref points directly to the DOM div that scrolls, preserving both behaviors without any changes to the observer effect code.

## Logic preserved exactly
- `IntersectionObserver` rootMargin `'0px 0px -70% 0px'`, topmost-visible-section tracking algorithm — untouched.
- All `data-section` anchors live in the child section components and are not touched by this file.
- `scrollRef.current?.querySelectorAll('[data-section]')` wiring — unchanged.
- `scrollRef.current?.querySelector('[data-section="${pendingScrollSectionId}"]')` + `scrollIntoView({ behavior: 'smooth', block: 'start' })` — unchanged.
- Per-tab dirty-state aggregation (`tabDirty`) — unchanged.
- Section registration (`registerSettingsSections(TAB_SECTIONS[activeTab])`) — unchanged.
- `StatusPill` and `PillTabs` composition — kept with identical props.

## Icon changes (C8)
- `Cog` (lucide) → `GearIcon` (@radix-ui/react-icons) for "Application Settings" tab
- `Zap` (lucide) → `LightningBoltIcon` (@radix-ui/react-icons) for "Quick Actions" tab
- `Settings` (lucide, header icon) → `GearIcon` (@radix-ui/react-icons)
- `Radio`, `ShieldOff`, `Wrench` — kept as lucide (no clean Radix match per C8)

## PillTabs icon type change
`PillTabs.tsx` previously typed `icon: LucideIcon`. Since we now pass Radix icon components, the type was widened to `IconComponent = React.ComponentType<{ width?, height?, aria-hidden?, className? }>` which is satisfied by both lucide and @radix-ui/react-icons components.

## Layout changes (C9)
- Outer `<div className="flex h-full w-full flex-col overflow-hidden bg-cs-bg">` → `<Flex direction="column" height="100%" overflow="hidden">`
- Header `<header className="shrink-0 border-b ...">` → `<Flex direction="column" flexShrink="0" px="7" py="3" style={{ borderBottom: '1px solid var(--cs-border)' }}>`
- `<h1 className="flex items-center gap-2 ...">` → `<Heading size="3" as="h1"><Flex align="center" gap="2">…</Flex></Heading>`
- Settings icon wrapped in `<Text color="amber">` for accent color
- Spacer `<div className="flex-1" />` → `<Box flexGrow="1" />`
- Scroll container `<div ref={scrollRef} className="flex-1 overflow-y-auto px-7 pb-10">` → `<Box ref={scrollRef} flexGrow="1" overflow="auto" px="7" pb="9">`
- RadioTab no-radio notice: `<div className="mt-4 rounded border ...">` → `<Box mt="4" px="3" py="2" style={…}>` with `<Text size="1" color="gray">`

## Test changes
No test files reference SettingsPanel, PillTabs, or StatusPill. All 283 tests passed without modification.

## Verification
- `pnpm typecheck` — clean (0 errors)
- `pnpm test` — 283/283 passed
- `pnpm lint src tests` — clean (0 errors)

## Concerns
None. The conversion is straightforward; the only judgment call was `<Box overflow="auto">` vs `<ScrollArea>`, which is clearly correct given the observer's `root` requirement.
