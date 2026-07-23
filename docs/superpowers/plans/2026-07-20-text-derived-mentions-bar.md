# Text-Derived Mentions Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the composer's stateful "Replying to `<name>`" chip with a bar derived purely from the composer text — one static `@Name` chip per unique `@[Name]` mention.

**Architecture:** Add a pure `mentionedNames(body)` helper beside the existing mention tokenizer. The `Composer` computes it from its own current text and renders the chip row, so the bar is always in sync with the text. The `replyingTo` state (never part of the send payload) is deleted end-to-end from `Composer`, `ChannelView`, and `DMView`.

**Tech Stack:** React 19, Zustand store, Tailwind (`cn` helper), Vitest + Testing Library (jsdom project), Biome.

**Spec:** [docs/superpowers/specs/2026-07-20-text-derived-mentions-bar-design.md](../specs/2026-07-20-text-derived-mentions-bar-design.md)

## Global Constraints

- Mention token format is `@[Name]`, recognized by `parseMessageContent` in `src/renderer/lib/messageContent.ts`. Do not introduce a second parser.
- Chips are **display-only**: no leading label, no `X`/remove button, non-interactive (`<span>`, no click handler).
- Chip styling mirrors `MentionPill`: **known contact** (`contacts.some(c => c.name === name)`) → `bg-cs-accent-soft/20 font-medium text-cs-text`; **unknown** → `bg-cs-bg-3 text-cs-text-dim`.
- Behavior is identical in `ChannelView` and `DMView` — no DM special-casing.
- Run tooling via `npx` in this worktree (`npx vitest`, `npx tsc`, `npx biome`), **not** `pnpm <script>` (pnpm deps-check reflink-fails in worktrees).
- Biome must be scoped to `src tests` (repo-wide lint trips on pre-existing build artifacts).
- `git commit` in this worktree requires the command sandbox disabled; typecheck/tests/biome run fine sandboxed.
- Do not change `ComposerHandle` (`insertMention` / `insertReaction`) or the send payload.

---

### Task 1: `mentionedNames` pure helper

**Files:**
- Modify: `src/renderer/lib/messageContent.ts` (add exported function at end)
- Test: `tests/unit/renderer/lib/messageContent.test.ts` (add import + `describe` block)

**Interfaces:**
- Consumes: existing `parseMessageContent(body: string): ContentToken[]` (same file).
- Produces: `mentionedNames(body: string): string[]` — unique mention names in first-appearance order.

- [ ] **Step 1: Write the failing tests**

Edit `tests/unit/renderer/lib/messageContent.test.ts`. Change the import line 2 from:

```ts
import { parseMessageContent } from '../../../../src/renderer/lib/messageContent';
```

to:

```ts
import { mentionedNames, parseMessageContent } from '../../../../src/renderer/lib/messageContent';
```

Then append this `describe` block to the end of the file:

```ts
describe('mentionedNames', () => {
  it('returns [] for plain text with no mentions', () => {
    expect(mentionedNames('hello world')).toEqual([]);
  });

  it('returns the single mentioned name', () => {
    expect(mentionedNames('hi @[Alice]!')).toEqual(['Alice']);
  });

  it('returns every mention in first-appearance order', () => {
    expect(mentionedNames('@[Alice] and @[Bob]')).toEqual(['Alice', 'Bob']);
  });

  it('de-duplicates repeated mentions, keeping first-appearance order', () => {
    expect(mentionedNames('@[Bob] hi @[Alice] @[Bob]')).toEqual(['Bob', 'Alice']);
  });

  it('ignores a partially-typed / broken token', () => {
    expect(mentionedNames('@[TLF hello')).toEqual([]);
  });

  it('extracts the name from a reaction insertion, ignoring the emoji', () => {
    expect(mentionedNames('@[K5TH] 👍 ')).toEqual(['K5TH']);
  });

  it('keeps names with spaces intact', () => {
    expect(mentionedNames('thanks @[Air Force 1 Pocket]')).toEqual(['Air Force 1 Pocket']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/lib/messageContent.test.ts`
Expected: FAIL — `mentionedNames is not a function` / import has no matching export.

- [ ] **Step 3: Implement the helper**

Append to `src/renderer/lib/messageContent.ts`:

```ts
/**
 * Ordered, de-duplicated names of every well-formed `@[Name]` mention in a
 * body. Only complete `@[…]` tokens are recognized, so a partially-typed or
 * broken mention (e.g. `@[TLF` with no closing bracket) is simply absent.
 */
export function mentionedNames(body: string): string[] {
  const seen = new Set<string>();
  for (const token of parseMessageContent(body)) {
    if (token.type === 'mention') seen.add(token.name);
  }
  return [...seen];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/lib/messageContent.test.ts`
Expected: PASS (all `parseMessageContent` and `mentionedNames` cases green).

- [ ] **Step 5: Commit** (sandbox disabled for the commit)

```bash
git add src/renderer/lib/messageContent.ts tests/unit/renderer/lib/messageContent.test.ts
git commit -m "feat(mentions-bar): add mentionedNames() text helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Text-derived chip bar in Composer + remove `replyingTo` end-to-end

This is one task because removing the `replyingTo`/`onClearReply` props from `Composer` and the two views is type-coupled — the tree does not typecheck until all three files change together.

**Files:**
- Modify: `src/renderer/components/Composer.tsx`
- Modify: `src/renderer/panels/ChannelView.tsx`
- Modify: `src/renderer/panels/DMView.tsx`
- Test: `tests/component/composer-reactions.test.tsx` (replace the reply-chip test; add derived-chip tests)

**Interfaces:**
- Consumes: `mentionedNames(body: string): string[]` (Task 1).
- Produces: `Composer` `Props` no longer declares `replyingTo?` or `onClearReply?`. `ComposerHandle` is unchanged. `ChannelView` / `DMView` no longer hold reply state.

- [ ] **Step 1: Rewrite the component test to the new behavior**

Replace the entire contents of `tests/component/composer-reactions.test.tsx` with:

```tsx
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { Composer, type ComposerHandle } from '@/components/Composer';
import { useStore } from '@/lib/store';
import type { Contact } from '../../src/shared/types';
import { DEFAULT_RADIO_SETTINGS } from '../../src/shared/types';

const baseProps = {
  onSend: async () => {},
  returnToSend: true,
  radioSettings: DEFAULT_RADIO_SETTINGS,
};

const contact = (name: string): Contact => ({
  key: `c:${name}`,
  publicKeyHex: name,
  name,
  kind: 'chat',
});

afterEach(() => useStore.setState({ contacts: [] }));

describe('Composer insertReaction', () => {
  test('inserts "@[name] emoji " into the empty field', () => {
    const ref = createRef<ComposerHandle>();
    render(<Composer ref={ref} {...baseProps} />);
    act(() => {
      ref.current?.insertReaction('K5TH', '👍');
    });
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    expect(ta.value).toBe('@[K5TH] 👍 ');
  });
});

describe('Composer text-derived mentions bar', () => {
  test('renders no bar when the field has no mentions', () => {
    render(<Composer {...baseProps} />);
    expect(screen.queryByTestId('composer-mentions')).toBeNull();
  });

  test('renders a chip for a mention inserted via the ref', () => {
    const ref = createRef<ComposerHandle>();
    render(<Composer ref={ref} {...baseProps} />);
    act(() => {
      ref.current?.insertReaction('K5TH', '👍');
    });
    expect(screen.getByText('@K5TH')).toBeTruthy();
  });

  test('lists every unique mention, de-duplicated, in order', () => {
    render(<Composer {...baseProps} />);
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@[Alice] hi @[Bob] @[Alice]' } });
    const bar = screen.getByTestId('composer-mentions');
    expect(within(bar).getAllByText(/^@/).map((n) => n.textContent)).toEqual(['@Alice', '@Bob']);
  });

  test('drops a chip when its mention token is broken', () => {
    render(<Composer {...baseProps} />);
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@[TLF] ' } });
    expect(screen.getByText('@TLF')).toBeTruthy();
    fireEvent.change(ta, { target: { value: '@[TLF ' } });
    expect(screen.queryByText('@TLF')).toBeNull();
  });

  test('styles a known contact differently from an unknown name', () => {
    useStore.setState({ contacts: [contact('Alice')] });
    render(<Composer {...baseProps} />);
    const ta = screen.getByTestId('message-composer-input') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@[Alice] @[Zzz]' } });
    expect(screen.getByText('@Alice').className).toContain('bg-cs-accent-soft/20');
    expect(screen.getByText('@Zzz').className).toContain('bg-cs-bg-3');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/component/composer-reactions.test.tsx`
Expected: FAIL — the `composer-mentions` bar / `@K5TH` chip does not exist yet.

- [ ] **Step 3: Update `Composer.tsx`**

In `src/renderer/components/Composer.tsx`:

(a) Change the lucide import (line 1) from:

```ts
import { Loader2, Reply, Send, X } from 'lucide-react';
```

to:

```ts
import { Loader2, Send } from 'lucide-react';
```

(b) Add the helper import next to the existing `../lib/*` imports (after the `useStore` import, line 6):

```ts
import { mentionedNames } from '../lib/messageContent';
```

(c) Remove these two lines from the `Props` interface (the `replyingTo` / `onClearReply` declarations):

```ts
  /** Sender name being replied to; shows the reply-context chip when set. */
  replyingTo?: string | null;
  onClearReply?: () => void;
```

(d) Remove `replyingTo,` and `onClearReply,` from the destructured parameter list in the `function Composer({ … })` signature.

(e) Add a `contacts` selector and derive the mention list. Immediately after the `setValue` definition block (right before `const [sending, setSending] = useState(false);`), insert:

```ts
  const contacts = useStore((s) => s.contacts);
  const mentions = mentionedNames(value);
```

(f) Replace the old reply-context chip block:

```tsx
      {replyingTo && (
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-cs-accent-soft/40 px-2 py-1 text-[11px] text-cs-accent">
            <Reply size={12} aria-hidden="true" />
            Replying to <span className="font-semibold">{replyingTo}</span>
          </span>
          <button
            type="button"
            onClick={onClearReply}
            aria-label="Cancel reply"
            className="text-cs-text-dim hover:text-cs-text"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
```

with the text-derived chip row:

```tsx
      {mentions.length > 0 && (
        <div data-testid="composer-mentions" className="mb-1 flex flex-wrap items-center gap-1">
          {mentions.map((name) => (
            <span
              key={name}
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px]',
                contacts.some((c) => c.name === name)
                  ? 'bg-cs-accent-soft/20 font-medium text-cs-text'
                  : 'bg-cs-bg-3 text-cs-text-dim',
              )}
            >
              @{name}
            </span>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Update `ChannelView.tsx`**

In `src/renderer/panels/ChannelView.tsx`:

(a) Delete the reply state (line 47):

```ts
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
```

(b) Delete the per-conversation reset effect and its comment (the block that resets `replyingTo` on `channel.key` change):

```ts
  // MainPane re-renders this component in place across conversation switches
  // (no `key` prop, by design — see Composer's own focus-on-navigate effect),
  // so component-local state like `replyingTo` would otherwise leak from one
  // channel to the next. Reset it whenever the active channel changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channel.key is the conversation-change trigger, not read inside the effect
  useEffect(() => {
    setReplyingTo(null);
  }, [channel.key]);
```

(c) In `onSend`, delete the line `setReplyingTo(null);` (the `try` block becomes just the `await api.sendMessage(...)` call).

(d) Replace the two handlers:

```ts
  const handleReply = (name: string) => {
    setReplyingTo(name);
    composerRef.current?.insertMention(name);
  };

  const handleReact = (name: string, emoji: string) => {
    setReplyingTo(name);
    composerRef.current?.insertReaction(name, emoji);
  };
```

with:

```ts
  const handleReply = (name: string) => {
    composerRef.current?.insertMention(name);
  };

  const handleReact = (name: string, emoji: string) => {
    composerRef.current?.insertReaction(name, emoji);
  };
```

(e) Remove the two `<Composer>` props (lines 179-180):

```tsx
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
```

(`useState` is still used by `pushing`, and `useEffect` by the history-fetch effect — keep both imports.)

- [ ] **Step 5: Update `DMView.tsx`**

In `src/renderer/panels/DMView.tsx`:

(a) The only `useState` use is the reply state, so drop it from the React import (line 3):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
```

becomes:

```ts
import { useCallback, useEffect, useRef } from 'react';
```

(b) Delete the reply state (line 43):

```ts
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
```

(c) Delete the per-conversation reset effect and its comment:

```ts
  // MainPane re-renders this component in place across conversation switches
  // (no `key` prop, by design — see Composer's own focus-on-navigate effect),
  // so component-local state like `replyingTo` would otherwise leak from one
  // contact to the next. Reset it whenever the active contact changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: contact.key is the conversation-change trigger, not read inside the effect
  useEffect(() => {
    setReplyingTo(null);
  }, [contact.key]);
```

(d) In `onSend`, delete the line `setReplyingTo(null);`.

(e) Replace the two handlers:

```ts
  const handleReply = (name: string) => {
    setReplyingTo(name);
    composerRef.current?.insertMention(name);
  };

  const handleReact = (name: string, emoji: string) => {
    setReplyingTo(name);
    composerRef.current?.insertReaction(name, emoji);
  };
```

with:

```ts
  const handleReply = (name: string) => {
    composerRef.current?.insertMention(name);
  };

  const handleReact = (name: string, emoji: string) => {
    composerRef.current?.insertReaction(name, emoji);
  };
```

(f) Remove the two `<Composer>` props (lines 142-143):

```tsx
        replyingTo={replyingTo}
        onClearReply={() => setReplyingTo(null)}
```

- [ ] **Step 6: Run the component test to verify it passes**

Run: `npx vitest run tests/component/composer-reactions.test.tsx`
Expected: PASS (insertReaction + all five derived-bar cases).

- [ ] **Step 7: Typecheck, then run the full suite and lint**

Run: `npx tsc --noEmit`
Expected: no errors (confirms `replyingTo`/`onClearReply` are gone from every caller and no unused imports remain).

Run: `npx vitest run`
Expected: all suites pass (514+ tests).

Run: `npx biome check src tests`
Expected: no diagnostics on the touched files (no unused `Reply`/`X`/`useState` imports).

- [ ] **Step 8: Commit** (sandbox disabled for the commit)

```bash
git add src/renderer/components/Composer.tsx src/renderer/panels/ChannelView.tsx src/renderer/panels/DMView.tsx tests/component/composer-reactions.test.tsx
git commit -m "feat(mentions-bar): derive composer mentions bar from text

Replace the replyingTo reply-context chip with a display-only row of
@Name chips derived from the composer text via mentionedNames(). Delete
the replyingTo state, its reset effect, and setReplyingTo calls from
Composer, ChannelView, and DMView.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Pure derivation helper → Task 1. ✓
- Bar derived from text, no independent state → Task 2 (Composer computes `mentionedNames(value)`; `replyingTo` deleted). ✓
- Delete part of a mention → chip removed → Task 1 test (broken token) + Task 2 "drops a chip when broken". ✓
- Add another mention → chip appears; lists all unique in order → Task 1 order/dedup tests + Task 2 "lists every unique mention". ✓
- Display-only, no X, no label → Task 2 chip JSX (no button, no label text). ✓
- Known vs unknown styling → Task 2 chip JSX + "styles a known contact differently". ✓
- Identical in ChannelView/DMView → both updated identically in Task 2. ✓
- Update old reply-chip test (`composer-reactions.test.tsx`) → Task 2 Step 1. ✓
- No send-payload change → `onSend` only loses `setReplyingTo(null)`; body unchanged. ✓

**Placeholder scan:** none — every step has concrete code/commands. ✓

**Type consistency:** `mentionedNames(body: string): string[]` defined in Task 1, consumed in Task 2 Composer. `ComposerHandle` (`insertMention`/`insertReaction`) untouched. Chip class strings match the tested substrings (`bg-cs-accent-soft/20`, `bg-cs-bg-3`). ✓
