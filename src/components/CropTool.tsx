import { useRef } from 'react';
import {
  cropForRatio,
  DEFAULT_GEOMETRY,
  fitCrop,
  flipHorizontal,
  MAX_ANGLE,
  moveCrop,
  orientedSize,
  resizeCrop,
  rotateClockwise,
  type CropHandle,
  type Rect,
} from '../lib/geometry';
import { useStore, type Photo } from '../state/store';
import { Icon } from './Icon';

const HANDLES: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// The crop as it was before straightening began, so levelling back to 0° gives the full crop back.
let straightenBase: Rect | null = null;

/** The rectangle you drag: handles, a rule-of-thirds grid, and the rest of the picture dimmed. */
export function CropOverlay({ photo }: { photo: Photo }) {
  const setGeometry = useStore((s) => s.setGeometry);
  const root = useRef<HTMLDivElement>(null);
  const g = photo.geometry;
  const { crop } = g;
  const oriented = orientedSize(g, photo.width, photo.height);
  const outW = Math.round(crop.w * oriented.width);
  const outH = Math.round(crop.h * oriented.height);
  const rectStyle = { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` };

  const begin = (e: React.PointerEvent, handle: CropHandle | 'move') => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    straightenBase = null;
    const start = crop;
    const startX = e.clientX;
    const startY = e.clientY;
    const box = root.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / box.width;
      const dy = (ev.clientY - startY) / box.height;
      const next =
        handle === 'move'
          ? moveCrop(start, dx, dy, g.angle, oriented.width, oriented.height)
          : resizeCrop(start, handle, dx, dy, g.lock, g.angle, oriented.width, oriented.height);
      setGeometry({ ...g, crop: next });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.altKey ? 0.002 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    straightenBase = null;
    const next = e.shiftKey
      ? resizeCrop(crop, 'se', delta[0], delta[1], g.lock, g.angle, oriented.width, oriented.height)
      : moveCrop(crop, delta[0], delta[1], g.angle, oriented.width, oriented.height);
    setGeometry({ ...g, crop: next });
  };

  return (
    <div className="crop" ref={root}>
      {/* The dimming is clipped to the picture. The handles aren't, so they can be grabbed at the very edge. */}
      <div className="crop__shade">
        <div className="crop__hole" style={rectStyle} />
      </div>
      <div
        className="crop__box"
        style={rectStyle}
        onPointerDown={(e) => begin(e, 'move')}
        onKeyDown={onKey}
        tabIndex={0}
        role="group"
        aria-label={`Crop, ${outW} by ${outH} pixels. Arrow keys move it, Shift and arrow keys resize it.`}
      >
        <span className="crop__grid crop__grid--v" />
        <span className="crop__grid crop__grid--h" />
        <span className="crop__size mono">
          {outW} × {outH}
        </span>
        {HANDLES.map((handle) => (
          <span key={handle} className={`crop__handle crop__handle--${handle}`} onPointerDown={(e) => begin(e, handle)} />
        ))}
      </div>
    </div>
  );
}

export function CropBar({ photo }: { photo: Photo }) {
  const setGeometry = useStore((s) => s.setGeometry);
  const finishCrop = useStore((s) => s.finishCrop);
  const g = photo.geometry;
  const oriented = orientedSize(g, photo.width, photo.height);
  const original = oriented.width / oriented.height;

  const shapes: { label: string; ratio: number | null; hint: string }[] = [
    { label: 'Free', ratio: null, hint: 'Any shape' },
    { label: 'Original', ratio: original, hint: 'The photo’s own shape' },
    { label: '1:1', ratio: 1, hint: 'Square' },
    { label: '4:5', ratio: 4 / 5, hint: 'Portrait post' },
    { label: '9:16', ratio: 9 / 16, hint: 'Story or reel' },
    { label: '3:2', ratio: 3 / 2, hint: '35mm film' },
    { label: '16:9', ratio: 16 / 9, hint: 'Widescreen' },
  ];
  const isOn = (ratio: number | null) => (ratio === null ? g.lock === null : g.lock !== null && Math.abs(g.lock - ratio) < 0.002);
  const pick = (ratio: number | null) => {
    straightenBase = null;
    setGeometry(
      ratio === null
        ? { ...g, lock: null }
        : { ...g, lock: ratio, crop: cropForRatio(ratio, g.angle, oriented.width, oriented.height) },
    );
  };

  const setAngle = (angle: number) => {
    straightenBase ??= g.crop;
    setGeometry({ ...g, angle, crop: fitCrop(straightenBase, angle, oriented.width, oriented.height) });
  };

  return (
    <div className="tool-bar crop-bar" role="group" aria-label="Crop and rotate">
      <div className="segmented crop-bar__shapes" role="group" aria-label="Crop shape">
        {shapes.map((shape) => (
          <button key={shape.label} className={isOn(shape.ratio) ? 'is-on' : ''} onClick={() => pick(shape.ratio)} aria-pressed={isOn(shape.ratio)} title={shape.hint}>
            {shape.label}
          </button>
        ))}
      </div>
      <label className="straighten" htmlFor="crop-angle">
        <span>Straighten</span>
        <input
          id="crop-angle"
          type="range"
          min={-MAX_ANGLE}
          max={MAX_ANGLE}
          step={0.1}
          value={g.angle}
          aria-valuetext={`${g.angle.toFixed(1)} degrees`}
          onChange={(e) => setAngle(+e.target.value)}
          onDoubleClick={() => setAngle(0)}
        />
        <span className="mono straighten__value">{g.angle > 0 ? '+' : ''}{g.angle.toFixed(1)}°</span>
      </label>
      <div className="crop-bar__actions">
        <button
          className="icon-btn"
          onClick={() => {
            straightenBase = null;
            setGeometry(rotateClockwise(g));
          }}
          aria-label="Rotate 90 degrees clockwise"
          title="Rotate 90°"
        >
          <Icon name="rotate" />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            straightenBase = null;
            setGeometry(flipHorizontal(g));
          }}
          aria-label="Mirror left to right"
          title="Mirror"
        >
          <Icon name="flip" />
        </button>
        <button
          className="btn btn--quiet"
          onClick={() => {
            straightenBase = null;
            setGeometry(DEFAULT_GEOMETRY);
          }}
        >
          Reset
        </button>
        <button className="btn btn--ghost" onClick={() => finishCrop(false)} title="Cancel (Esc)">
          Cancel
        </button>
        <button className="btn btn--primary" onClick={() => finishCrop(true)} title="Apply (Enter)">
          <Icon name="check" size={14} />
          Done
        </button>
      </div>
    </div>
  );
}
