import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from 'react-error-boundary';
import { App } from './App';
import { AppErrorFallback, logError } from './components/errors/ErrorFallback';
import './index.css';
import { initScrollbarReveal } from './lib/scrollbarReveal';
import { applyTheme, readLegacyThemePref, resolveTheme, systemPrefersDark } from './lib/theme';

// Apply theme before mount so the first frame matches the user preference and
// system theme — avoids the white flash on cold boot. The authoritative theme
// pref lives in ui-state.json (read async after hydration); we fall back to
// the legacy localStorage value if present, then to 'auto'.
applyTheme(resolveTheme(readLegacyThemePref() ?? 'auto', systemPrefersDark()));

// Reveal scrollbar handles on hover / while scrolling, then auto-hide.
initScrollbarReveal();

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={AppErrorFallback} onError={logError}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
