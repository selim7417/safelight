import { useRef } from 'react';
import { accentFor } from '../lib/accent';
import { curveStats } from '../lib/curves';
import { CONTROL_GROUPS, DEFAULT_RECIPE, encodeRecipe, type Control, type Recipe } from '../lib/recipe';
import { getStock, type StockKind } from '../lib/stocks';
import { rollOf, useActivePhoto, useStore } from '../state/store';
import { CurveChart, HistogramChart } from './Charts';
import { Icon } from './Icon';

// The chemistry each kind of film is really developed in.
const PROCESS: Record<StockKind, string> = {
  'Colour negative': 'C-41',
  'Motion picture': 'ECN-2',
  Slide: 'E-6',
  'Black & white': 'D-76',
  Infrared: 'E-6',
};

function FilmBox({ recipe }: { recipe: Recipe }) {
  const stock = getStock(recipe.stock);
  const stats = curveStats(stock);
  return (
    <section className="filmbox" style={{ background: stock.box, color: stock.boxInk }} aria-label={`Loaded film: ${stock.name}`}>
      <div className="filmbox__top">
        <span>{stock.kind}</span>
        <span>{PROCESS[stock.kind]} · 135-36</span>
      </div>
      <div className="filmbox__name">{stock.name.replace(` ${stock.iso}`, '')}</div>
      <div className="filmbox__iso">
        <span className="filmbox__iso-value">{stock.iso}</span>
        <span className="filmbox__specs">
          <span>{stats.latitude.toFixed(0)} stops latitude</span>
          <span>{stock.grain.sizeUm} µm grain</span>
        </span>
      </div>
    </section>
  );
}

function Slider({ control, value }: { control: Control; value: number }) {
  const setRecipe = useStore((s) => s.setRecipe);
  const beginEdit = useStore((s) => s.beginEdit);
  const editing = useRef(false);
  const def = DEFAULT_RECIPE[control.key];
  const modified = value !== def;
  const toPercent = (v: number) => ((v - control.min) / (control.max - control.min)) * 100;
  const start = () => {
    if (!editing.current) {
      editing.current = true;
      beginEdit();
    }
  };
  const end = () => {
    editing.current = false;
  };
  const a = Math.min(toPercent(def), toPercent(value));
  const b = Math.max(toPercent(def), toPercent(value));
  const id = `control-${control.key}`;
  return (
    <div className={`slider ${modified ? 'is-modified' : ''}`} title={control.hint}>
      <div className="slider__head">
        <label htmlFor={id}>{control.label}</label>
        <button
          className="slider__value mono"
          onClick={() => setRecipe({ [control.key]: def }, true)}
          disabled={!modified}
          aria-label={`Reset ${control.label}`}
          title={modified ? 'Click to reset' : undefined}
        >
          {control.format(value)}
        </button>
      </div>
      <div className="slider__track">
        <div className="slider__rail" />
        <div className="slider__origin" style={{ left: `${toPercent(def)}%` }} />
        <div className="slider__fill" style={{ left: `${a}%`, width: `${b - a}%` }} />
        <input
          id={id}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          aria-valuetext={control.format(value)}
          onPointerDown={start}
          onPointerUp={end}
          onKeyDown={start}
          onKeyUp={end}
          onBlur={end}
          onDoubleClick={() => setRecipe({ [control.key]: def }, true)}
          onChange={(e) => setRecipe({ [control.key]: +e.target.value })}
        />
      </div>
    </div>
  );
}

export function Panel() {
  const photo = useActivePhoto();
  const showToast = useStore((s) => s.showToast);
  const applyToRoll = useStore((s) => s.applyToRoll);
  const photos = useStore((s) => rollOf(s.photos).length);
  const resetRecipe = useStore((s) => s.resetRecipe);
  const setOverlay = useStore((s) => s.setOverlay);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  if (!photo) return <aside className="panel" aria-label="Controls" />;
  const { recipe } = photo;
  const stock = getStock(recipe.stock);
  const code = encodeRecipe(recipe);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      showToast('Recipe copied. Paste it onto any photo to reuse the look.');
    } catch {
      showToast(`Your browser blocked the clipboard. The recipe is ${code}`);
    }
  };

  return (
    <aside className="panel" aria-label="Controls" style={{ ['--accent' as string]: accentFor(stock.box, stock.boxInk) }}>
      <div className="panel__film">
        <FilmBox recipe={recipe} />
        <p className="panel__note">{stock.note}</p>
        <CurveChart recipe={recipe} />
        <HistogramChart />
      </div>
      <div className="panel__adjust">
        {CONTROL_GROUPS.map((group) => (
          <section key={group.title} className="control-group">
            <div className="control-group__head">
              <h3>{group.title}</h3>
              {group.title === 'In camera' && (
                <button
                  className={`text-btn ${tool === 'test' ? 'is-on' : ''}`}
                  onClick={() => setTool(tool === 'test' ? null : 'test')}
                  aria-pressed={tool === 'test'}
                  disabled={tool === 'camera' || photo.status !== 'ready'}
                  title="Compare exposures side by side (T)"
                >
                  <Icon name="strip" size={12} />
                  Test strip
                </button>
              )}
            </div>
            {group.controls.map((control) => (
              <Slider key={control.key} control={control} value={recipe[control.key]} />
            ))}
          </section>
        ))}
        <section className="recipe">
          <h3>Recipe</h3>
          <button className="recipe__code mono" onClick={copyCode} title="Copy recipe">
            <span>{code}</span>
            <Icon name="copy" size={13} />
          </button>
          {photos > 1 && (
            <button className="btn btn--ghost btn--full" onClick={applyToRoll}>
              <Icon name="layers" size={13} />
              Use this look on the whole roll
            </button>
          )}
          <div className="phone-actions">
            <button className="btn btn--ghost" onClick={undo} disabled={!photo.undo.length || tool === 'crop' || tool === 'camera'} aria-label="Undo">
              <Icon name="undo" size={13} />
            </button>
            <button className="btn btn--ghost" onClick={redo} disabled={!photo.redo.length || tool === 'crop' || tool === 'camera'} aria-label="Redo">
              <Icon name="redo" size={13} />
            </button>
            <button className="btn btn--ghost" onClick={resetRecipe}>
              <Icon name="reset" size={13} />
              Reset
            </button>
            <button className="btn btn--ghost" onClick={() => setOverlay('help')}>
              <Icon name="help" size={13} />
              How it works
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}
