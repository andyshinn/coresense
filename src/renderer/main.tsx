import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { App } from './App';
import { AppErrorFallback, logError } from './components/errors/ErrorFallback';
import './index.css';
import { log } from './lib/logger';
import { initScrollbarReveal } from './lib/scrollbarReveal';
import { applyTheme, readLegacyThemePref, resolveTheme, systemPrefersDark } from './lib/theme';

// Apply theme before mount so the first frame matches the user preference and
// system theme — avoids the white flash on cold boot. The authoritative theme
// pref lives in ui-state.json (read async after hydration); we fall back to
// the legacy localStorage value if present, then to 'auto'.
applyTheme(resolveTheme(readLegacyThemePref() ?? 'auto', systemPrefersDark()));

// Reveal scrollbar handles on hover / while scrolling, then auto-hide.
initScrollbarReveal();

// Safety net for promises nobody handled: log them so they reach the in-app
// Logs panel too. The browser still reports them to the DevTools console.
window.addEventListener('unhandledrejection', (event) => {
  log.error('unhandled rejection', event.reason);
});

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={AppErrorFallback} onError={logError}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
