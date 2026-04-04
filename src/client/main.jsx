import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// Request persistent storage — prevents iOS from evicting IndexedDB under storage pressure
if (navigator.storage?.persist) {
  navigator.storage.persist();
}

// Prompt Safari to check for SW updates when the app regains focus.
// Chrome checks on every navigation; Safari only checks ~every 24h without this.
if ('serviceWorker' in navigator) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then(reg => reg?.update());
    }
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
);
