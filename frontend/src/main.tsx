import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'framer-motion';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import './index.css';
import { bootstrapI18n } from './i18n/config';
import App from './App';
import { registerServiceWorker } from './lib/registerServiceWorker';

// Windows lacks flag emoji glyphs (Chromium shows "GB" instead of 🇬🇧).
// Injects the "Twemoji Country Flags" font only where needed.
polyfillCountryFlagEmojis();

MotionGlobalConfig.skipAnimations =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

registerServiceWorker();

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

// Awaited rather than fired and forgotten: react-i18next would otherwise render
// the raw keys for one frame and then swap them for real text.
//
// Rendered anyway if it fails. The language now arrives over the network as
// its own chunk, so a flaky connection could reject this promise, and an app
// that shows its keys is bad where an app that shows nothing at all is broken.
void bootstrapI18n().then(render, error => {
  console.error('Could not load translations, rendering anyway:', error);
  render();
});
