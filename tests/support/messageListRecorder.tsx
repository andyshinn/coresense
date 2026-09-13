import { type ComponentType, type Key, type ReactNode, type Ref, useImperativeHandle, useLayoutEffect } from 'react';

// A recording stand-in for @virtuoso.dev/message-list, for components that drive
// the list declaratively (`data` prop + `initialLocation`) rather than through
// its ref. Wire it up with:
//
//   vi.mock('@virtuoso.dev/message-list', async (importOriginal) => ({
//     ...(await importOriginal<typeof import('@virtuoso.dev/message-list')>()),
//     ...(await import('../support/messageListRecorder')),
//   }));
//
// The real list needs layout, so jsdom renders at most one row and can never show
// where it scrolled. This fake renders every item through `ItemContent` and records
// where each mount asked to land, the latest `data` prop, and every imperative call
// made through its ref (so a test can assert there are none). It checks what the
// component asks for, not whether the real list delivers it: a landing the library
// clamps against unmeasured rows looks identical here. Only a real browser shows that.

interface DataProp {
  data?: unknown[] | null;
  scrollModifier?: unknown;
}

interface Props {
  ref?: Ref<unknown>;
  data?: DataProp;
  initialData?: unknown[];
  initialLocation?: unknown;
  context?: unknown;
  ItemContent?: ComponentType<{ index: number; data: unknown; context: unknown; prevData: unknown; nextData: unknown }>;
  EmptyPlaceholder?: ComponentType<{ context: unknown }>;
  computeItemKey?: (params: { index: number; data: unknown; context: unknown }) => Key;
  onScroll?: (location: unknown) => void;
}

export const listRecorder = {
  /** `initialLocation` of each list mount, in mount order. */
  mounts: [] as unknown[],
  /** The `data` prop from the most recent render. */
  data: undefined as DataProp | undefined,
  /** Every call made through the list's ref, in order. */
  calls: [] as { name: string; args: unknown[] }[],
  /** The `onScroll` prop from the most recent render, so a test can report a scroll. */
  onScroll: undefined as ((location: unknown) => void) | undefined,
  reset() {
    listRecorder.mounts = [];
    listRecorder.data = undefined;
    listRecorder.calls = [];
    listRecorder.onScroll = undefined;
  },
};

const record =
  (name: string) =>
  (...args: unknown[]) => {
    listRecorder.calls.push({ name, args });
  };

export function VirtuosoMessageList({
  ref,
  data,
  initialData,
  initialLocation,
  context,
  ItemContent,
  EmptyPlaceholder,
  computeItemKey,
  onScroll,
}: Props) {
  listRecorder.data = data;
  listRecorder.onScroll = onScroll;
  useImperativeHandle(
    ref,
    () => ({
      scrollToItem: record('scrollToItem'),
      scrollIntoView: record('scrollIntoView'),
      cancelSmoothScroll: record('cancelSmoothScroll'),
      notifyItemsChanged: record('notifyItemsChanged'),
      scrollerElement: () => null,
      getScrollLocation: () => ({ isAtBottom: true, bottomOffset: 0, listOffset: 0, scrollHeight: 0, visibleListHeight: 0 }),
      height: () => 0,
      // data.append, data.replace, … — every method is recorded.
      data: new Proxy({}, { get: (_target, name) => record(`data.${String(name)}`) }),
    }),
    [],
  );
  // The real list reads initialLocation once, when it mounts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: record once per mount, like the prop it mirrors
  useLayoutEffect(() => {
    listRecorder.mounts.push(initialLocation);
  }, []);
  const items = data?.data ?? initialData ?? [];
  if (items.length === 0 && EmptyPlaceholder) return <EmptyPlaceholder context={context} />;
  if (!ItemContent) return null;
  return (
    <>
      {items.map((item, index) => (
        <ItemContent
          key={computeItemKey ? computeItemKey({ index, data: item, context }) : index}
          index={index}
          data={item}
          context={context}
          prevData={items[index - 1] ?? null}
          nextData={items[index + 1] ?? null}
        />
      ))}
    </>
  );
}

export function VirtuosoMessageListLicense({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
