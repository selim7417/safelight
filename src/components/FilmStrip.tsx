import { useEffect, useMemo, useRef } from 'react';
import { drawThumbnail, LIVE_SOURCE, refreshLiveThumbnail } from '../gl/thumbnails';
import { getLiveCamera } from '../lib/camera';
import { DEFAULT_GEOMETRY } from '../lib/geometry';
import { STOCKS } from '../lib/stocks';
import { useActivePhoto, useStore } from '../state/store';

const THUMB_W = 300;
const THUMB_H = 200;

/** A grease-pencil box, the way a photographer marks the keeper on a contact sheet. */
function ChinaMarker() {
  return (
    <svg className="china-marker" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M4.5 5.5C24 3.5 58 4.2 96 3.8c1.2 19 .8 41-.5 62.4C66 67.6 28 66.4 3.6 66.6 2.7 44 3 22 5.4 2.6"
      />
    </svg>
  );
}

export function FilmStrip() {
  const photo = useActivePhoto();
  const setRecipe = useStore((s) => s.setRecipe);
  const developing = useStore((s) => s.developing);
  const tool = useStore((s) => s.tool);
  // Film goes in before the first shot of a no-peeking roll, and stays in until it's developed.
  const filmLocked = useStore((s) => s.tool === 'camera' && s.camera.mode === 'blind' && s.camera.shots.length > 0);
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const stripRef = useRef<HTMLDivElement>(null);

  const recipe = photo?.recipe;
  const selected = recipe?.stock;
  const adjustments = useMemo(() => {
    if (!recipe) return '';
    const { stock: _stock, ...rest } = recipe;
    return JSON.stringify(rest);
  }, [recipe]);
  const framing = photo ? JSON.stringify(photo.geometry) : '';
  const liveRecipe = useRef(recipe);
  liveRecipe.current = recipe;

  // Every frame shows the real photo through its stock. Rendered a few at a time, nearest first,
  // so the strip fills in without blocking the sliders.
  useEffect(() => {
    // Dragging a crop handle shouldn't redraw 15 thumbnails. They catch up when the tool closes.
    if (!photo?.thumb || !recipe || tool === 'camera' || tool === 'crop') return;
    let cancelled = false;
    const start = Math.max(0, STOCKS.findIndex((s) => s.id === selected));
    const order = [...STOCKS]
      .map((s, i) => ({ s, d: Math.abs(i - start) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.s);
    let i = 0;
    let raf = 0;
    const thumb = photo.thumb;
    const pump = () => {
      if (cancelled) return;
      const until = performance.now() + 7;
      while (i < order.length && performance.now() < until) {
        const stock = order[i++];
        const target = canvases.current.get(stock.id);
        if (target) drawThumbnail(photo.id, thumb, { ...recipe, stock: stock.id }, target, photo.geometry);
      }
      if (i < order.length) raf = requestAnimationFrame(pump);
    };
    const timer = window.setTimeout(pump, adjustments ? 90 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
    // Changing only the selected stock does not change any frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id, photo?.thumb, adjustments, framing, tool]);

  // With the camera on, the strip shows the live scene through every film on screen, a few per frame.
  useEffect(() => {
    if (tool !== 'camera' || filmLocked) return;
    const slow = window.matchMedia('(pointer: coarse)').matches;
    let raf = 0;
    let next = 0;
    let beat = 0;
    let source: HTMLCanvasElement | null = null;
    const pump = () => {
      raf = requestAnimationFrame(pump);
      const camera = getLiveCamera();
      const current = liveRecipe.current;
      const strip = stripRef.current;
      if (!camera || !current || !strip) return;
      beat++;
      if (slow && beat % 2) return;
      if (!source || beat % 4 === 0) source = refreshLiveThumbnail(camera.video);
      const bounds = strip.getBoundingClientRect();
      const geometry = { ...DEFAULT_GEOMETRY, flip: camera.mirrored };
      for (let drawn = 0, tried = 0; drawn < (slow ? 1 : 2) && tried < STOCKS.length; tried++) {
        const stock = STOCKS[next++ % STOCKS.length];
        const target = canvases.current.get(stock.id);
        if (!target) continue;
        const box = target.getBoundingClientRect();
        if (box.right < bounds.left || box.left > bounds.right) continue;
        drawThumbnail(LIVE_SOURCE, source, { ...current, stock: stock.id }, target, geometry);
        drawn++;
      }
    };
    raf = requestAnimationFrame(pump);
    return () => cancelAnimationFrame(raf);
  }, [tool, filmLocked]);

  useEffect(() => {
    if (!selected) return;
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-stock="${selected}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: developing ? 'auto' : 'smooth' });
  }, [selected, developing]);

  const onWheel = (e: React.WheelEvent) => {
    const el = stripRef.current;
    if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
  };

  return (
    <div className={`strip ${filmLocked ? 'is-locked' : ''}`} ref={stripRef} onWheel={onWheel} role="group" aria-label="Film stocks">
      <div className="strip__track">
        {STOCKS.map((stock, i) => {
          const isOn = stock.id === selected;
          return (
            <button
              key={stock.id}
              data-stock={stock.id}
              className={`frame ${isOn ? 'is-on' : ''}`}
              onClick={() => {
                if (!isOn) setRecipe({ stock: stock.id }, true);
              }}
              aria-pressed={isOn}
              disabled={filmLocked}
              aria-label={`${stock.name}, ${stock.kind}`}
              title={stock.note}
            >
              <span className="frame__code">
                <span>{stock.code}</span>
                <span className="frame__arrow">▸{i + 1}A</span>
              </span>
              <span className="frame__picture">
                <canvas
                  width={THUMB_W}
                  height={THUMB_H}
                  ref={(el) => {
                    if (el) canvases.current.set(stock.id, el);
                    else canvases.current.delete(stock.id);
                  }}
                />
                {isOn && <ChinaMarker key={stock.id} />}
              </span>
              <span className="frame__label">
                <i style={{ background: stock.box }} />
                {stock.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
