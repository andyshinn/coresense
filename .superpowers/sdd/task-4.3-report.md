# Task 4.3 Report — ContactDetail rail to Radix

## Dialog close behavior decision

### Remove dialog → `AlertDialog` with `AlertDialog.Action`
The existing Remove handler (line 188-191 in original) calls `setRemoveOpen(false)` **synchronously** before dispatching `void act(...)`. The dialog was already guaranteed to close regardless of async outcome. Using `AlertDialog.Action` is therefore safe: Radix closes the dialog on action click, which matches exactly the original behavior. The async `act()` call runs fire-and-forget after close, same as before.

### Block dialog → `BlockSenderDialog` unchanged
`BlockSenderDialog` is a complex shadcn dialog with internal async state (`submitting`, retry on error). It keeps the dialog open on failure via `setSubmitting(false)`. This component lives in a separate file (`src/renderer/components/BlockSenderDialog.tsx`) and is not being converted here. We pass the same props (`client`, `open`, `prefill`, `onClose`) — behavior is identical.

## DataList wrapping

All `KeyValueRow` calls are now inside a single `<DataList.Root orientation="horizontal" size="1">` block. Previously they were bare siblings in a `<div className="space-y-1.5">`. The `KeyValueRow` component (already Radix) renders `DataList.Item` which requires a `DataList.Root` ancestor — this is now correctly provided.

## Icon choices

| Original (lucide) | Replacement | Rationale |
|---|---|---|
| `MessageSquare` | `ChatBubbleIcon` (@radix-ui/react-icons) | C8 canonical mapping |
| `Star` | `StarIcon` / `StarFilledIcon` | C8 canonical, toggled on `rc.favourite` |
| `Plus` | `PlusIcon` (@radix-ui/react-icons) | C8 canonical mapping |
| `Minus` | `MinusIcon` (@radix-ui/react-icons) | C8 canonical mapping |
| `Share2` | `Share2Icon` (@radix-ui/react-icons) | C8 canonical mapping |
| `Ban` | kept lucide `Ban` | C8: no acceptable Radix match |
| `MapPin` | kept lucide `MapPin` | C8: no acceptable Radix match |
| `Radio` | kept lucide `Radio` | C8: no acceptable Radix match |
| `ShieldCheck` | kept lucide `ShieldCheck` | C8: no acceptable Radix match |
| `TerminalSquare` | kept lucide `TerminalSquare` | C8: no acceptable Radix match |

## Layout changes

- Root wrapper: `<div className="space-y-3">` → `<Flex direction="column" gap="3">`
- Header: `<div className="flex items-start gap-2.5">` → `<Flex align="start" gap="2">`
- Avatar box: inline `style={{}}` for exact pixel values (36×36, border, borderRadius, background)
- Name: `<span className="text-sm font-semibold">` → `<Text size="2" weight="bold" truncate>`
- Action row: `CardActionButton` (accepts `LucideIcon` type only) → local `ActionButton` wrapper around Radix `<Button size="1" variant="surface">` with optional `color` prop. Destructive actions (Block, Remove) use `color="red"`.
- Metadata section: `<div className="space-y-1.5">` + bare `KeyValueRow` calls → `<DataList.Root>` wrapping all `KeyValueRow` items.
- Path subsection: `<div className="border-t border-cs-border pt-2">` → `<Box style={{ borderTop, paddingTop }}>` with `style={{}}` for cs-vars. Path label: `<div className="font-mono text-[10px] uppercase tracking-wider">` → `<Text size="1" style={{ fontFamily, textTransform, letterSpacing, color }}>`.

## Tests touched

No tests reference `ContactDetail` directly. All 79 test files / 283 tests pass without modification.

## Concerns

None. The conversion is straightforward. GPS-validity logic, click-to-copy, and all conditional rendering preserved verbatim. The `SetPathEditor` integration is untouched (separate component, same props).
