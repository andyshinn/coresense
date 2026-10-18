import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/lib/notify';
import { useStore } from '@/lib/store';
import { getSectionHandle } from '@/panels/settings/sectionHandles';
import { useSectionDraft, useSettingsSection } from '@/panels/settings/useSectionDraft';

interface Draft {
  a: number;
  b: number;
  /** Not owned by the section: `eq` ignores it. */
  other: string;
}

const eq = (x: Draft, y: Draft) => x.a === y.a && x.b === y.b;
const base: Draft = { a: 1, b: 2, other: 'x' };

describe('useSectionDraft', () => {
  it('adopts a server push while the draft is clean', () => {
    const { result, rerender } = renderHook(({ saved }) => useSectionDraft(saved, eq), {
      initialProps: { saved: base },
    });
    const pushed = { ...base, a: 5 };
    rerender({ saved: pushed });
    expect(result.current.draft).toBe(pushed);
    expect(result.current.dirty).toBe(false);
  });

  it('keeps an in-progress edit when a server push arrives', () => {
    const { result, rerender } = renderHook(({ saved }) => useSectionDraft(saved, eq), {
      initialProps: { saved: base },
    });
    act(() => result.current.setDraft((d) => ({ ...d, b: 9 })));
    rerender({ saved: { ...base, a: 5 } });
    expect(result.current.draft).toEqual({ ...base, b: 9 });
    expect(result.current.dirty).toBe(true);
  });

  it('judges dirtiness with eq, not object identity', () => {
    const { result, rerender } = renderHook(({ saved }) => useSectionDraft(saved, eq), {
      initialProps: { saved: base },
    });
    // A field eq ignores differs: still clean.
    act(() => result.current.setDraft((d) => ({ ...d, other: 'y' })));
    expect(result.current.dirty).toBe(false);
    // A fresh saved object that eq considers equal: still clean.
    rerender({ saved: { ...base } });
    expect(result.current.dirty).toBe(false);
  });

  it('reset returns the draft to the saved value', () => {
    const { result } = renderHook(() => useSectionDraft(base, eq));
    act(() => result.current.setDraft((d) => ({ ...d, a: 7 })));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.draft).toBe(base);
    expect(result.current.dirty).toBe(false);
  });
});

describe('useSettingsSection', () => {
  const initial = useStore.getState();
  beforeEach(() => useStore.setState({ settingsUi: initial.settingsUi }));
  afterEach(() => vi.restoreAllMocks());

  const mount = (onSave: (d: Draft) => Promise<void>) =>
    renderHook(() => useSettingsSection({ id: 'test-section', saved: base, eq, onSave }));

  it('reports its dirty flag to the store and clears it on unmount', () => {
    const { result, unmount } = mount(async () => {});
    act(() => result.current.setDraft((d) => ({ ...d, a: 2 })));
    expect(useStore.getState().settingsUi.dirtyById['test-section']).toBe(true);
    unmount();
    expect(useStore.getState().settingsUi.dirtyById['test-section']).toBe(false);
    expect(getSectionHandle('test-section')).toBeUndefined();
  });

  it('setGroup merges a patch into one object-valued field', () => {
    type Nested = { g: { x: number; y: number }; z: number };
    const saved: Nested = { g: { x: 1, y: 2 }, z: 3 };
    const { result } = renderHook(() =>
      useSettingsSection({ id: 'nested', saved, eq: (a, b) => a.g.x === b.g.x, onSave: async () => {} }),
    );
    act(() => result.current.setGroup('g', { x: 9 }));
    expect(result.current.draft).toEqual({ g: { x: 9, y: 2 }, z: 3 });
    // Primitive-valued keys are rejected at compile time: spreading 3 gives {}.
    // @ts-expect-error z is a number, not an object-valued group
    void (() => result.current.setGroup('z', 5));
  });

  it('section Save toasts a failure and swallows it', async () => {
    const failure = vi.spyOn(notify, 'failure').mockImplementation(() => {});
    const err = new Error('boom');
    const { result } = mount(async () => {
      throw err;
    });
    await act(() => result.current.save());
    expect(failure).toHaveBeenCalledWith('Save', err);
    expect(result.current.saving).toBe(false);
  });

  it('the registered handle saves the latest draft and rethrows failures', async () => {
    const failure = vi.spyOn(notify, 'failure').mockImplementation(() => {});
    const onSave = vi.fn(async (_d: Draft) => {});
    const { result } = mount(onSave);
    act(() => result.current.setDraft((d) => ({ ...d, a: 4 })));
    await act(() => getSectionHandle('test-section')?.save() ?? Promise.resolve());
    expect(onSave).toHaveBeenCalledWith({ ...base, a: 4 });

    onSave.mockRejectedValueOnce(new Error('nope'));
    await expect(getSectionHandle('test-section')?.save()).rejects.toThrow('nope');
    expect(failure).not.toHaveBeenCalled();
  });
});
