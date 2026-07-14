# CoreSense UI — conventions for building with this design system

CoreSense is a **MeshCore** desktop client. Its UI is a **dark "Field Console"
theme** (amber-on-near-black) built on shadcn/ui + Radix, styled with **Tailwind
v4 utility classes** and CSS-variable tokens. Import every component from
`window.CoreSenseUI` (the bundle in `_ds_bundle.js`).

## Setup & wrapping

- **Dark by default — no theme wrapper needed.** `styles.css` ships the dark
  `--cs-*` palette at `:root` (`color-scheme: dark`), so screens render dark
  automatically. Build on dark surfaces (`bg-cs-bg`), not white.
- **Tooltips** must be inside a `TooltipProvider` (wrap the screen/app once):
  `<TooltipProvider>…</TooltipProvider>`. Without it, `Tooltip` does not render.
- **Sidebar** layouts must be wrapped in `SidebarProvider`.
- **Toasts** are imperative: mount `<Toaster />` once near the root, then call
  `toast.success(msg)` / `toast.error(msg)` / `toast.warning(msg)` to notify.
  Do not render toasts as JSX.

## Styling idiom — Tailwind utility classes + tokens

Style with utility classes (no CSS files, no inline styles for the design
language). Two token families ship — both available as `bg-…`, `text-…`,
`border-…`, `ring-…`, and with opacity (`bg-primary/10`):

**shadcn semantic tokens** (role/state): `bg-background`, `bg-card`,
`bg-popover`, `bg-primary` (+ `text-primary-foreground`), `bg-secondary`,
`bg-muted`, `bg-accent`, `bg-destructive`; `text-foreground`,
`text-muted-foreground`; `border-border`, `border-input`; focus ring `ring-ring`.

**`cs-*` "Field Console" brand palette** (use these for on-brand surfaces & text):
- Surfaces, darkest → lighter: `bg-cs-bg`, `bg-cs-bg-2`, `bg-cs-bg-3`
- Text: `text-cs-text` (primary cream), `text-cs-text-muted`, `text-cs-text-dim`
- Status: `text-cs-accent` (amber, the brand accent), `text-cs-online` (green),
  `text-cs-warn` (amber), `text-cs-danger` (red); soft accent `bg-cs-accent-soft`
- Borders: `border-cs-border`, `border-cs-border-strong`

**Type:** Inter is the sans default. Use `font-mono` for hex public keys, node
IDs, and signal/telemetry values (SNR/RSSI, voltages, hop counts); pair with
`tabular-nums` for aligned numbers. Labels are often `text-[10px] uppercase
tracking-wider text-cs-text-dim`.

## Where the truth lives

- **`styles.css`** → its `@import` closure (`_ds_bundle.css` = all tokens +
  utilities, `fonts/fonts.css` = Inter). Read it to see exactly which utility
  classes resolve.
- **Per component:** `components/general/<Name>/<Name>.d.ts` (the prop contract —
  e.g. Button's `variant`/`size`, Sidebar's `collapsible`) and
  `<Name>.prompt.md` (usage). Read the component's `.d.ts` before setting props.

## Idiomatic example

```jsx
const { Button, Badge, KeyValueRow } = window.CoreSenseUI;

function NodeCard() {
  return (
    <div className="w-72 rounded-lg border border-cs-border bg-cs-bg-2 p-4 text-cs-text">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-medium">Ridgeline Repeater</span>
        <Badge variant="secondary">Repeater</Badge>
      </div>
      <KeyValueRow label="Public key" value="a3f9c1d8…2b7e" mono />
      <KeyValueRow label="SNR" value="+9.5 dB" mono />
      <div className="mt-4 flex gap-2">
        <Button size="sm">Message</Button>
        <Button size="sm" variant="outline">Trace path</Button>
      </div>
    </div>
  );
}
```
