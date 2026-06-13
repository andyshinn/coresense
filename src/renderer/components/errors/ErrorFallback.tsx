import { MapIcon, RotateCcw, TriangleAlert } from 'lucide-react';
import type { ErrorInfo } from 'react';
import type { FallbackProps } from 'react-error-boundary';
import { log } from '../../lib/logger';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

/** Best-effort human-readable message from whatever a component threw. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Shared `onError` handler for every boundary. Render-time crashes only reach
 * the console today; route them through the renderer logger so they show up
 * with the same `renderer` tag as the rest of the app. No telemetry — console
 * only, per project convention.
 */
export function logError(error: unknown, info: ErrorInfo) {
  log.error('React render error caught by boundary', error, info.componentStack);
}

interface ErrorFallbackBaseProps {
  /** Lucide icon component for the fallback header. */
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  error: unknown;
  actionLabel: string;
  onAction: () => void;
}

/**
 * Centered fallback block sized to fill its boundary's container. Mirrors the
 * look of the existing "Map tiles not installed" state in MapView so a crashed
 * subtree still feels like part of the app.
 */
function ErrorFallbackBase({ icon: Icon, title, description, error, actionLabel, onAction }: ErrorFallbackBaseProps) {
  const message = errorMessage(error);
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-lg space-y-4 text-center">
        <div
          className={cn('mx-auto flex h-14 w-14 items-center justify-center rounded-full', 'bg-cs-danger/10 text-cs-danger')}
        >
          <Icon className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {message ? (
          <pre className="max-h-40 overflow-auto rounded bg-muted px-3 py-2 text-left font-mono text-xs whitespace-pre-wrap text-cs-text-muted">
            {message}
          </pre>
        ) : null}
        <Button variant="outline" size="sm" onClick={onAction}>
          <RotateCcw />
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Last-resort, full-window fallback. A reset rarely helps once the whole tree
 * has thrown, so this offers a hard reload instead.
 */
export function AppErrorFallback({ error }: FallbackProps) {
  return (
    <ErrorFallbackBase
      icon={TriangleAlert}
      title="CoreSense hit an unexpected error"
      description="The app couldn't recover this view. Reloading usually clears it."
      error={error}
      actionLabel="Reload app"
      onAction={() => window.location.reload()}
    />
  );
}

/**
 * Per-panel fallback used by MainPane. The shell (LeftNav / RightRail /
 * TitleBar) stays interactive; navigating to another panel auto-resets the
 * boundary via its `resetKeys`.
 */
export function PanelErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <ErrorFallbackBase
      icon={TriangleAlert}
      title="This view crashed"
      description="Something went wrong rendering this panel. Try again, or switch to another view from the left."
      error={error}
      actionLabel="Try again"
      onAction={resetErrorBoundary}
    />
  );
}

/** Map-specific fallback — remounts just MapCanvas on retry. */
export function MapErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <ErrorFallbackBase
      icon={MapIcon}
      title="The map failed to render"
      description="The map view ran into an error (WebGL, tiles, or markers). Reloading the map usually recovers it."
      error={error}
      actionLabel="Reload map"
      onAction={resetErrorBoundary}
    />
  );
}
