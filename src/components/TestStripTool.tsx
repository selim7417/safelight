import { useStore } from '../state/store';
import { Icon } from './Icon';

const STEPS = [
  { label: '⅓ stop', value: 1 / 3 },
  { label: '½ stop', value: 0.5 },
  { label: '1 stop', value: 1 },
];

const formatStops = (v: number) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(Math.abs(v * 2) % 1 < 0.01 ? 1 : 2)}`);

/**
 * A printer finds the right exposure by giving a strip of paper stepped exposures and reading
 * which band looks right. Here the picture itself is the strip, and clicking a band sets that exposure.
 */
export function TestStripBands({ bands, exposure }: { bands: number[]; exposure: number }) {
  const setRecipe = useStore((s) => s.setRecipe);
  const setTool = useStore((s) => s.setTool);
  const showToast = useStore((s) => s.showToast);
  return (
    <div className="test-strip" role="group" aria-label="Exposure test strip">
      {bands.map((value) => {
        const current = Math.abs(value - exposure) < 0.005;
        return (
          <button
            key={value}
            className={current ? 'is-current' : ''}
            onClick={() => {
              if (!current) setRecipe({ exposure: value }, true);
              setTool(null);
              showToast(current ? 'Exposure unchanged' : `Exposure set to ${formatStops(value)} EV`);
            }}
            aria-label={`Set exposure to ${formatStops(value)} EV${current ? ', the current exposure' : ''}`}
          >
            <span>{formatStops(value)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function TestStripBar({ step, onStep }: { step: number; onStep: (step: number) => void }) {
  const setTool = useStore((s) => s.setTool);
  return (
    <div className="tool-bar" role="group" aria-label="Test strip">
      <span className="tool-bar__text">Pick the band that looks right.</span>
      <div className="segmented" role="group" aria-label="Difference between bands">
        {STEPS.map((s) => (
          <button key={s.label} className={step === s.value ? 'is-on' : ''} onClick={() => onStep(s.value)} aria-pressed={step === s.value}>
            {s.label}
          </button>
        ))}
      </div>
      <button className="btn btn--ghost" onClick={() => setTool(null)} title="Close (Esc)">
        <Icon name="close" size={13} />
        Close
      </button>
    </div>
  );
}
