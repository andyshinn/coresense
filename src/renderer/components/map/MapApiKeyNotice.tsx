import { KeyRound } from 'lucide-react';
import { useStore } from '../../lib/store';

/**
 * Persistent, self-gating banner overlaid on the map. Renders nothing when a
 * key is configured and accepted; otherwise prompts the user to add or fix
 * their Protomaps API key. The bundled low-detail basemap renders underneath.
 */
export function MapApiKeyNotice() {
  const status = useStore((s) => s.mapTileStatus);
  const setActiveKey = useStore((s) => s.setActiveKey);
  const requestScrollToSection = useStore((s) => s.requestScrollToSection);

  if (status.keyConfigured && !status.keyRejected) return null;
  const rejected = status.keyConfigured && status.keyRejected;

  const openSettings = () => {
    setActiveKey('tool:settings:app');
    requestScrollToSection('app-map');
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
      <div className="pointer-events-auto flex max-w-2xl items-start gap-3 rounded border border-cs-border bg-cs-bg-2/95 px-3 py-2 shadow-lg backdrop-blur">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-cs-accent" aria-hidden />
        <div className="text-[12px] text-cs-text">
          {rejected ? (
            <p>Your Protomaps API key was rejected. Check the key in settings to load detailed map tiles.</p>
          ) : (
            <p>
              Add a Protomaps API key to load detailed map tiles.{' '}
              <a
                href="https://maps.protomaps.com/keys"
                target="_blank"
                rel="noreferrer noopener"
                className="text-cs-accent underline underline-offset-2 hover:opacity-80"
              >
                Get a key
              </a>{' '}
              (free tier available).
            </p>
          )}
          <button
            type="button"
            onClick={openSettings}
            className="mt-1.5 rounded border border-cs-border bg-cs-bg-3 px-2 py-0.5 text-[12px] text-cs-text hover:bg-cs-bg-2"
          >
            Open map settings
          </button>
        </div>
      </div>
    </div>
  );
}
