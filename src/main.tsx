import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/doto/index.css';
import '@fontsource-variable/geist-mono/index.css';
import './styles/app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);

// Offline support, once built. Some hosts forbid service workers; the app doesn't need one to run.
if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker?.register('./sw.js').catch(() => undefined);
    } catch {
      /* Sandboxed frames can throw just for touching navigator.serviceWorker. */
    }
  });
}
