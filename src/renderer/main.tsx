import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { applyTheme, loadThemePref, resolveTheme, systemPrefersDark } from './lib/theme';

// Apply theme before mount so the first frame matches the user preference and
// system theme — avoids the white flash on cold boot.
applyTheme(resolveTheme(loadThemePref(), systemPrefersDark()));

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
