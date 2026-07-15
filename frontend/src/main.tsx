import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'framer-motion';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import './index.css';
import './i18n/config';
import App from './App';

// Windows lacks flag emoji glyphs (Chromium shows "GB" instead of 🇬🇧).
// Injects the "Twemoji Country Flags" font only where needed.
polyfillCountryFlagEmojis();

MotionGlobalConfig.skipAnimations =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
