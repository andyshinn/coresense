import { type FormEvent, useState } from 'react';

interface Props {
  onSubmit: (key: string) => void;
}

export function ApiKeyGate({ onSubmit }: Props) {
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
        className="flex w-full max-w-md flex-col gap-4 rounded border border-cs-border bg-cs-bg-2 p-6"
      >
        <div>
          <h1 className="text-lg font-semibold text-cs-text">CoreSense</h1>
          <p className="mt-1 text-xs text-cs-text-muted">
            Paste the API key printed in the main process console on first launch. The key is stored
            at <code className="font-mono text-cs-text">userData/config.json</code> and is shared
            across all clients.
          </p>
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
