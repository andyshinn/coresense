import { Loader2, Send } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { RadioSettings } from '../../shared/types';
import { loraAirtimeMs } from '../lib/airtime';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';

export interface ComposerHandle {
  insertMention: (name: string) => void;
}

interface Props {
  onSend: (body: string) => Promise<void> | void;
  disabled?: boolean;
  // When true, Return sends and Shift+Return inserts a newline. When false,
  // Return inserts a newline and Cmd/Ctrl+Return sends. Toggleable via App
  // Settings.composer.returnToSend (Phase 8).
  returnToSend: boolean;
  radioSettings: RadioSettings;
  placeholder?: string;
  // Conversation key the textarea belongs to. When provided, the in-progress
  // text is persisted to ui.drafts so it survives restarts and view switches.
  draftKey?: string;
  // When true, focus the textarea on mount and whenever the conversation
  // (draftKey) changes, so the user can start typing immediately on navigate.
  autoFocus?: boolean;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    onSend,
    disabled,
    returnToSend,
    radioSettings,
    placeholder = 'Send a message…',
    draftKey,
    autoFocus,
  },
  ref,
) {
  const draft = useStore((s) => (draftKey ? (s.ui.drafts[draftKey] ?? '') : ''));
  const setDraft = useStore((s) => s.setDraft);
  const [localValue, setLocalValue] = useState('');
  const value = draftKey ? draft : localValue;
  const setValue = (v: string | ((prev: string) => string)) => {
    if (draftKey) {
      const next = typeof v === 'function' ? v(draft) : v;
      setDraft(draftKey, next);
    } else {
      setLocalValue((prev) => (typeof v === 'function' ? v(prev) : v));
    }
  };
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    insertMention: (name: string) => {
      const ta = textareaRef.current;
      const token = `@[${name}] `;
      setValue((prev) => {
        const start = ta?.selectionStart ?? prev.length;
        const end = ta?.selectionEnd ?? prev.length;
        const needsLeadingSpace = start > 0 && !/\s$/.test(prev.slice(0, start));
        const insertion = (needsLeadingSpace ? ' ' : '') + token;
        const next = prev.slice(0, start) + insertion + prev.slice(end);
        // Move caret to just after inserted token on the next frame, once
        // React has flushed the controlled-value update into the textarea.
        requestAnimationFrame(() => {
          const node = textareaRef.current;
          if (!node) return;
          const caret = start + insertion.length;
          node.focus();
          node.setSelectionRange(caret, caret);
        });
        return next;
      });
    },
  }));
  // Focus the field on navigate. Keyed on draftKey so switching between
  // conversations (which re-renders rather than remounts this component)
  // still re-focuses. Skipped while disabled — nothing to type into.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draftKey is the conversation-change trigger, not read inside the effect
  useEffect(() => {
    if (autoFocus && !disabled) textareaRef.current?.focus();
  }, [autoFocus, disabled, draftKey]);

  const trimmed = value.trim();
  const airtime = loraAirtimeMs(
    byteLength(trimmed) + 32 /* rough wrapper overhead */,
    radioSettings,
  );

  const submit = async () => {
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setValue('');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const sendCombo = returnToSend
      ? e.key === 'Enter' && !e.shiftKey
      : e.key === 'Enter' && (e.metaKey || e.ctrlKey);
    if (sendCombo) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-cs-border bg-cs-bg-2 px-3 py-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
          className={cn(
            'min-h-[36px] max-h-32 flex-1 resize-none rounded border border-cs-border bg-cs-bg px-2 py-1.5 text-sm text-cs-text outline-none transition-colors',
            'placeholder:text-cs-text-dim focus:border-cs-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!trimmed || sending || disabled}
          aria-label="Send"
          title={returnToSend ? 'Send (Return)' : 'Send (⌘Return)'}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded border border-cs-border bg-cs-bg text-cs-text-muted transition-colors',
            'hover:border-cs-accent hover:text-cs-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-cs-text-dim">
        <span>
          {trimmed.length}/184 chars
          {airtime > 0 && trimmed.length > 0 && ` · ~${airtime.toFixed(0)} ms airtime`}
        </span>
        <span>{returnToSend ? '↩ send · ⇧↩ newline' : '⌘↩ send · ↩ newline'}</span>
      </div>
    </div>
  );
});

// Rough UTF-8 byte length — enough for the airtime estimate.
function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
