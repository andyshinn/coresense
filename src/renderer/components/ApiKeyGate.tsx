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
    <div className="flex h-full items-center justify-center bg-slate-950 p-6">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <div>
          <h1 className="text-lg font-semibold text-slate-100">CoreSense</h1>
          <p className="mt-1 text-xs text-slate-400">
            Paste the API key printed in the main process console on first launch. The key is stored
            at <code className="text-slate-300">userData/config.json</code> and is shared across all
            clients.
          </p>
        </div>
        <input
          type="password"
          ref={(el) => el?.focus()}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="64-character hex key"
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
