import { type FormEvent, useState } from 'react';

interface Props {
  /** Absolute path of the config.json holding the key, from the capabilities
   *  probe. Shown so the user knows exactly where to read the key. Null until
   *  the probe resolves. */
  configPath?: string | null;
  onSubmit: (key: string) => void;
}

export function ApiKeyGate({ configPath, onSubmit }: Props) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="flex h-full items-center justify-center bg-cs-bg p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xl flex-col gap-4 rounded border border-cs-border bg-cs-bg-2 p-6"
      >
        <div>
          <h1 className="text-lg font-semibold text-cs-text">CoreSense</h1>
          <p className="mt-1 text-xs text-cs-text-muted">
            CoreSense is protected by an API key. On the computer running CoreSense, open the CoreSense desktop app and go to{' '}
            <span className="font-medium text-cs-text">Settings → API Access</span> to view and copy the key — or read the{' '}
            <code className="font-mono text-cs-text">apiKey</code> value from:
          </p>
          <code className="mt-2 block break-all rounded border border-cs-border bg-cs-bg px-2 py-1.5 font-mono text-[11px] text-cs-text">
            {configPath ?? 'userData/config.json'}
          </code>
        </div>
        <input
          type="password"
          ref={(el) => el?.focus()}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="64-character hex key"
          className="rounded border border-cs-border-strong bg-cs-bg px-3 py-2 font-mono text-sm text-cs-text outline-none placeholder:text-cs-text-dim focus:border-cs-accent"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="rounded bg-cs-accent px-3 py-2 text-sm font-medium text-cs-bg hover:bg-cs-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
