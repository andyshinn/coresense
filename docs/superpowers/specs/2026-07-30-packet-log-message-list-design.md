# Packet Log — migrate to VirtuosoMessageList, drop react-virtuoso

Date: 2026-07-30
Branch: `feat+packet-log-inspector`

## Problem

The Packet Log is the only component in the app importing `react-virtuoso`
(`Virtuoso`). Every other append-at-bottom feed — the chat message list
(`src/renderer/components/MessageList.tsx`) and the Logs panel
(`src/renderer/panels/logs/LogsPanel.tsx`) — uses the licensed
`@virtuoso.dev/message-list` (`VirtuosoMessageList`).

Two costs follow from that:

1. The repo carries a second virtualization library for a single component.
2. The Packet Log doesn't get the message-list package's scroll handling.
   It approximates it with `followOutput="auto"` plus two workarounds: an
   `initialItemCount={Math.min(visible.length, 40)}` prop to force a first
   paint before `ResizeObserver` fires, and a mount-only `useEffect` calling
   `scrollToIndex` to land on the newest packet.

## Goal

Render the Packet Log with `VirtuosoMessageList` using an
`auto-scroll-to-bottom` scroll modifier, and remove `react-virtuoso` from
`package.json`.

## Scroll behavior

New packets scroll the list to the newest entry **only when the viewport is
already at the bottom**. If the user has scrolled up — the normal state while
inspecting an older packet in the right rail — the scroll position is left
alone, and following resumes once they scroll back down.

```ts
scrollModifier: {
  type: 'auto-scroll-to-bottom',
  autoScroll: ({ atBottom }) => atBottom && 'smooth',
}
```

`ItemLocationCallback` is typed `(params) => ScrollBehavior | boolean |
ItemLocation`, so returning `false` is a supported "do not move".

This deliberately differs from `LogsPanel`, whose `autoScroll` always returns
`{ index: 'LAST', align: 'end' }` and therefore yanks the viewport to the
bottom on every new entry — which is why Logs needs a pause toggle. The Packet
Log buffer reaches 20,000 entries (`liveBufferSize`, `src/shared/types.ts`) and
its rows are the subject of an inspector, so holding position matters more here.
No pause control is added; not yanking makes one unnecessary.

**Accepted nuance:** changing the source filter or the search query while
scrolled up leaves the viewport at a similar offset in the newly filtered list
rather than jumping to the newest match. This matches current behavior, so it
is not a regression.

## Component structure

Mirrors the existing `panels/logs/` split — a pure filter module plus a
standalone row component.

| File | Change |
| --- | --- |
| `src/renderer/lib/packetLogFilter.ts` | **New.** Pure `filterPackets(packets, { source, query })`, lifted from the `useMemo` in `PacketLog.tsx`. Precedent: `src/renderer/panels/logs/filter.ts`. |
| `src/renderer/components/PacketRow.tsx` | **New.** Today's local `Row`, plus the `GRID` template, `badge()` and `rssiClass()`. Exported so it renders directly under test. Precedent: `src/renderer/panels/logs/LogRow.tsx`. |
| `src/renderer/components/PacketLog.tsx` | Keeps the toolbar, the column-header row (importing `GRID`) and the list wiring. Drops from ~180 to ~110 lines. |

Row props reach `PacketRow` through the list's `context` prop
(`{ selectedId, onSelect }`) rather than a closure, so `ItemContent` stays a
stable component reference across renders — the same approach `MessageList`
uses with its `RowContext`.

Two workarounds are deleted:

- `INITIAL_RENDER_COUNT` / `initialItemCount` — no longer needed.
- The mount-only `scrollToIndex` effect — replaced by
  `initialLocation={{ index: 'LAST', align: 'end' }}`.

The empty state ("No packets match this filter.") moves from a hand-rolled
conditional to the list's `EmptyPlaceholder` prop.

## Test strategy

`VirtuosoMessageList` renders exactly **one** row under jsdom, even with a
`ResizeObserver` polyfill and stubbed `getBoundingClientRect` / `offsetHeight`
(verified by spike). Without a polyfill it throws `ResizeObserver not found`.
This is why `MessageList` and `LogsPanel` have no component tests today, and it
means the five `PacketLog`-rendering assertions in
`tests/component/packet-log-select.test.tsx` cannot survive the swap as
written — they pass now only because of `initialItemCount`, which the
message-list package has no equivalent for.

Coverage is preserved by testing the extracted units instead of the virtualized
list:

| File | Change |
| --- | --- |
| `tests/unit/renderer/lib/packetLogFilter.test.ts` | **New.** `source` both/rf/ble; query matching across `codeName`, `payloadHex` and `rssi`; empty query passes everything. |
| `tests/component/packet-log-row.test.tsx` | **New.** Renders `PacketRow` directly: "Group Text" humanization for a mesh `GroupText` payload, `PUSH ADVERT` for a companion frame, no mesh-decode error in DETAILS for a companion row, and click → `onSelect`. |
| `tests/component/packet-log-select.test.tsx` | The five `PacketLog`-rendering tests are removed (replaced by the two files above). The `useDeselectOnOutsideClick` harness tests at the bottom of the file do not render `PacketLog` and stay unchanged. |
| `tests/e2e/packet-log.spec.ts` | Extended: assert at least one `packet-row` renders and that clicking one opens the right-rail inspector. This is the only place the real virtualized list is exercised. |

The default e2e fixture (`tests/fixtures/frames/e2e-connect.json`, two frames
replayed onto the bus as companion packets) is expected to produce at least one
row, but the existing spec only asserts on the toolbar header, so this is
unconfirmed. Confirm it while implementing; if the default fixture yields no
rows, add a fixture containing a mesh frame (`GROUP_TEXT_HEX`, already used by
that spec) rather than weakening the assertion.

## Dependency removal

`react-virtuoso` (`^4.18.7`) is removed from `package.json` once
`PacketLog.tsx` — its only importer — no longer imports it.
`@virtuoso.dev/message-list` is already a dependency and the license-key
plumbing (`src/renderer/lib/virtuosoLicense.ts`, read from
`VITE_VIRTUOSO_LICENSE_KEY`) already exists; the new list wraps in
`<VirtuosoMessageListLicense>` the same way `MessageList` and `LogsPanel` do.

## Out of scope

- Any pause / freeze control for the Packet Log.
- Changing what a row displays, the toolbar, the filter controls, or the
  right-rail inspector.
- Refactoring `MessageList` or `LogsPanel`.

## Verification

Beyond unit/component/e2e tests: build and drive the real app, scroll up in a
populated Packet Log, and confirm arriving packets do not yank the viewport,
then scroll to the bottom and confirm following resumes.
