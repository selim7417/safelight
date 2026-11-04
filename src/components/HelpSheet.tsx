import { useEffect } from 'react';
import { useStore } from '../state/store';
import { Icon } from './Icon';

const KEYS: [string, string][] = [
  ['← →', 'Previous or next film stock'],
  ['↑ ↓', 'Previous or next photo'],
  ['C', 'Compare with the original'],
  ['K', 'Crop and rotate'],
  ['T', 'Test strip'],
  ['V', 'Camera'],
  ['Space', 'Take a photo'],
  ['Z', 'Inspect at 100%'],
  ['R', 'Reset adjustments'],
  ['E', 'Export'],
  ['⌘ Z', 'Undo'],
  ['⇧ ⌘ Z', 'Redo'],
];

export function HelpSheet() {
  const setOverlay = useStore((s) => s.setOverlay);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOverlay]);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && setOverlay(null)}>
      <div className="sheet help" role="dialog" aria-modal="true" aria-label="About Safelight">
        <button className="icon-btn sheet__close" onClick={() => setOverlay(null)} aria-label="Close" autoFocus>
          <Icon name="close" />
        </button>
        <h2>A darkroom in your browser</h2>
        <p>
          Filters paint a look over your photo. Safelight develops it: light is split across three dye layers,
          scattered back through the film base, run through each stock’s characteristic curve, and printed with
          grain that lives in the density of the image.
        </p>
        <p>
          Your photos never leave this device. There is no server, no account and no upload. Open as many as you like,
          drop them anywhere, or paste them from the clipboard. Paste a recipe code to reuse a look.
        </p>
        <h3>Shortcuts</h3>
        <dl className="keys">
          {KEYS.map(([key, text]) => (
            <div key={key}>
              <dt className="mono">{key}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p className="help__small">
          Film stocks here are original models inspired by the character of classic emulsions. They aren’t measured from,
          or affiliated with, any manufacturer. Sample photographs are from Unsplash, credited by name above each picture.
        </p>
      </div>
    </div>
  );
}
