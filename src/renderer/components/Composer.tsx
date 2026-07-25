import { Loader2, Send } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { RadioSettings } from '../../shared/types';
import { loraAirtimeMs } from '../lib/airtime';
import type { ApiClient } from '../lib/api';
import { shouldSendOnKey } from '../lib/composerKeys';
import { mentionedNames } from '../lib/messageContent';
import { MAX_MESSAGE_LENGTH } from '../lib/messageLimits';
import { useStore } from '../lib/store';
import { cn } from '../lib/utils';
import { ComposerMacroPopover, type ComposerMacroPopoverHandle } from '../panels/macros/inchat/ComposerMacroPopover';

// Counter turns yellow once this few characters remain before the cap.
const WARN_REMAINING = 20;

export interface ComposerHandle {
  insertMention: (name: string) => void;
  insertReaction: (name: string, content: string) => void;
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
  // API client + conversation target, used by the `/` macro popover to render a
  // macro to plain text before it replaces the input.
  client?: ApiClient | null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { onSend, disabled, returnToSend, radioSettings, placeholder = 'Send a message…', draftKey, autoFocus, client },
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
  const contacts = useStore((s) => s.contacts);
  const mentions = mentionedNames(value);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // `/` macro picker. Open while the draft starts with a slash, until dismissed
  // with Escape or a macro is chosen.
  const macroRef = useRef<ComposerMacroPopoverHandle>(null);
  const [macroDismissed, setMacroDismissed] = useState(false);
  const showMacros = !!client && value.startsWith('/') && !macroDismissed;
  // Re-arm the picker once the draft no longer starts with a slash.
  useEffect(() => {
    if (!value.startsWith('/')) setMacroDismissed(false);
  }, [value]);

  useImperativeHandle(ref, () => {
    const insertAtCaret = (token: string) => {
      const ta = textareaRef.current;
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
    };
    return {
      insertMention: (name: string) => insertAtCaret(`@[${name}] `),
      insertReaction: (name: string, content: string) => insertAtCaret(`@[${name}] ${content} `),
    };
  });
  // Focus the field on navigate. Keyed on draftKey so switching between
  // conversations (which re-renders rather than remounts this component)
  // still re-focuses. Skipped while disabled — nothing to type into.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draftKey is the conversation-change trigger, not read inside the effect
  useEffect(() => {
    if (autoFocus && !disabled) textareaRef.current?.focus();
  }, [autoFocus, disabled, draftKey]);

  const trimmed = value.trim();
  const airtime = loraAirtimeMs(byteLength(trimmed) + 32 /* rough wrapper overhead */, radioSettings);

  const count = trimmed.length;
  const atLimit = count >= MAX_MESSAGE_LENGTH;
  const nearLimit = !atLimit && count >= MAX_MESSAGE_LENGTH - WARN_REMAINING;

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
    // The `/` macro picker grabs navigation keys while it's open.
    if (showMacros && (macroRef.current?.count ?? 0) > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        macroRef.current?.move(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        macroRef.current?.move(-1);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        macroRef.current?.choose();
        return;
      }
    }
    if (showMacros && e.key === 'Escape') {
      e.preventDefault();
      setMacroDismissed(true);
      return;
    }
    // The macOS emoji/character picker (⌃⌘Space) and IMEs confirm a candidate
    // with Return while the field is mid-composition. The browser flags that
    // keydown via isComposing (keyCode 229 where isComposing is unreliable);
    // pass it through so a composing Return inserts the emoji instead of
    // leaking out as our send shortcut and firing the draft. See NOTES.md.
    const sendCombo = shouldSendOnKey(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        isComposing: e.nativeEvent.isComposing || e.keyCode === 229,
      },
      returnToSend,
    );
    if (sendCombo) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-1 border-t border-cs-border bg-cs-bg-2 px-3 py-2">
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
      <div className="relative flex items-end gap-2">
        {showMacros && (
          <ComposerMacroPopover
            ref={macroRef}
            query={value.slice(1)}
            client={client ?? null}
            targetKey={draftKey}
            onExpand={(text) => {
              setValue(text);
              setMacroDismissed(true);
              requestAnimationFrame(() => textareaRef.current?.focus());
            }}
            onClose={() => setMacroDismissed(true)}
          />
        )}
        <textarea
          data-testid="message-composer-input"
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={disabled}
          className={cn(
            'min-h-[36px] max-h-32 flex-1 resize-none rounded border border-cs-border bg-cs-bg px-2 py-1.5 text-sm text-cs-text outline-none transition-colors',
            'placeholder:text-cs-text-dim focus:border-cs-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <button
          data-testid="message-send-button"
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
          <span className={cn(atLimit && 'text-cs-danger', nearLimit && 'text-cs-warn')}>
            {count}/{MAX_MESSAGE_LENGTH}
          </span>{' '}
          chars
          {airtime > 0 && count > 0 && ` · ~${airtime.toFixed(0)} ms airtime`}
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
