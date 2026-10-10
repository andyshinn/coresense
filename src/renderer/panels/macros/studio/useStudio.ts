import { type RefObject, useCallback, useRef, useState } from 'react';
import type { MacroRenderMode, MacroScope, MacroTemplate } from '../../../../shared/macros/types';
import { MACRO_CATALOG } from '../lib/catalog';
import { focusCaret, spliceAtCaret, varTag } from '../lib/insertAtCaret';
import { deriveMacroMode } from '../lib/macroMode';

/** @deprecated Use MacroRenderMode; kept only for studio/bridge.ts's import. */
export type PreviewMode = MacroRenderMode;

export interface StudioState {
  taRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  scope: MacroScope;
  setScope: (s: MacroScope) => void;
  channelKey: string | undefined;
  setChannelKey: (k: string | undefined) => void;
  contactKey: string | undefined;
  setContactKey: (k: string | undefined) => void;
  previewMode: MacroRenderMode;
  setPreviewMode: (m: MacroRenderMode) => void;
  /** Splice text in at the textarea caret and restore focus + caret. */
  insertText: (text: string) => void;
  insertVar: (name: string) => void;
  isNew: boolean;
  dirty: boolean;
}

/** Editing state for one macro in the studio. A null seed starts a new macro. */
export function useStudio(macro: MacroTemplate | null): StudioState {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(macro?.template ?? '');
  const [name, setName] = useState(macro?.name ?? '');
  const [scope, setScope] = useState<MacroScope>(macro?.scope ?? 'global');
  const [channelKey, setChannelKey] = useState<string | undefined>(macro?.channelKey);
  const [contactKey, setContactKey] = useState<string | undefined>(macro?.contactKey);
  const [previewMode, setPreviewMode] = useState<MacroRenderMode>(() =>
    macro && deriveMacroMode(macro.template, MACRO_CATALOG) === 'reply' ? 'reply' : 'send',
  );

  // Read the latest value through a ref so the insert callbacks stay stable —
  // the right-rail Reference registers them via the store bridge and shouldn't
  // re-register on every keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;

  const insertText = useCallback((text: string) => {
    const ta = taRef.current;
    const current = valueRef.current;
    const start = ta?.selectionStart ?? current.length;
    const end = ta?.selectionEnd ?? current.length;
    const res = spliceAtCaret(current, start, end, text);
    setValue(res.value);
    focusCaret(taRef, res.caret);
  }, []);

  const insertVar = useCallback((n: string) => insertText(varTag(n)), [insertText]);

  const isNew = macro === null;
  const dirty = isNew
    ? value.trim() !== '' || name.trim() !== ''
    : value !== macro.template ||
      name !== macro.name ||
      scope !== macro.scope ||
      channelKey !== macro.channelKey ||
      contactKey !== macro.contactKey;

  return {
    taRef,
    value,
    setValue,
    name,
    setName,
    scope,
    setScope,
    channelKey,
    setChannelKey,
    contactKey,
    setContactKey,
    previewMode,
    setPreviewMode,
    insertText,
    insertVar,
    isNew,
    dirty,
  };
}
