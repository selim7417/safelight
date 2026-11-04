import { useCallback, useEffect, useRef, useState } from 'react';
import { FilmRenderer, type TestStrip, type View } from '../gl/renderer';
import { closeCamera, getLiveCamera, openCamera, type Facing, type LiveCamera } from '../lib/camera';
import { DEFAULT_GEOMETRY, frameToSource, FULL_CROP, orientedSize, outputSize, type Affine, type Size } from '../lib/geometry';
import { testStripBands } from '../lib/recipe';
import { getStock } from '../lib/stocks';
import { getBitmap, useActivePhoto, useStore } from '../state/store';
import { CameraBar, ViewfinderMarks } from './CameraTool';
import { CropBar, CropOverlay } from './CropTool';
import { Icon } from './Icon';
import { TestStripBar, TestStripBands } from './TestStripTool';

const MARGIN = 28;
const DEVELOP_MS = 2500;
const LIGHTS_MS = 750;

interface Zoom {
  /** Device pixels per image pixel. Null means fit to the stage. */
  scale: number | null;
  /** Image position at the centre of the stage, 0 to 1. */
  cx: number;
  cy: number;
}

const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const fn = () => setNarrow(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return narrow;
};

export function Stage() {
  const photo = useActivePhoto();
  const tool = useStore((s) => s.tool);
  const cameraMode = useStore((s) => s.camera.mode);
  const setDeveloping = useStore((s) => s.setDeveloping);
  const markDeveloped = useStore((s) => s.markDeveloped);
  const hasOwnPhotos = useStore((s) => s.photos.some((p) => p.file));
  const narrow = useNarrow();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<FilmRenderer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [zoomLabel, setZoomLabel] = useState<string | null>(null);
  const [developCaption, setDevelopCaption] = useState<number | null>(null);
  const [testStep, setTestStep] = useState(0.5);
  const [facing, setFacing] = useState<Facing>(() => (window.matchMedia('(pointer: coarse)').matches ? 'environment' : 'user'));
  const [live, setLive] = useState<LiveCamera | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const testCount = narrow ? 5 : 7;
  const bands = photo ? testStripBands(photo.recipe.exposure, testStep, testCount) : [];

  // Everything the draw call needs, readable from animation frames without re-creating them.
  const state = useRef({ photo, tool, cameraMode, bands, testStep, live });
  state.current = { photo, tool, cameraMode, bands, testStep, live };

  const zoomRef = useRef<Zoom>({ scale: null, cx: 0.5, cy: 0.5 });
  const splitValue = useRef(0.5);
  const toolbarHeight = useRef(0);
  const effects = useRef({ develop: 1, lights: 1, time: 0 });
  const grainSeed = useRef<[number, number]>([0, 0]);
  const rafRef = useRef(0);
  const animRef = useRef(0);
  const skipRef = useRef<(() => void) | null>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, width: 1, height: 1 });
  const sizeRef = useRef<Size>({ width: 3, height: 2 });

  /** What's on the stage: the finished frame, the whole photo while cropping, or the camera. */
  const frameFor = useCallback((): { size: Size; transform: Affine } | null => {
    const s = state.current;
    const r = rendererRef.current!;
    if (s.tool === 'camera') {
      if (!s.live) return null;
      const g = { ...DEFAULT_GEOMETRY, flip: s.live.mirrored };
      return { size: { width: s.live.width, height: s.live.height }, transform: frameToSource(g, s.live.width, s.live.height) };
    }
    const g = s.photo?.geometry ?? DEFAULT_GEOMETRY;
    const w = r.imageWidth;
    const h = r.imageHeight;
    if (s.tool === 'crop') {
      return { size: orientedSize(g, w, h), transform: frameToSource({ ...g, crop: FULL_CROP }, w, h) };
    }
    return { size: outputSize(g, w, h), transform: frameToSource(g, w, h) };
  }, []);

  const fitScale = useCallback((size: Size) => {
    const canvas = canvasRef.current!;
    const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
    const margin = MARGIN * dpr;
    const bottom = Math.max(MARGIN, toolbarHeight.current + 8) * dpr;
    return Math.min((canvas.width - margin * 2) / size.width, (canvas.height - margin - bottom) / size.height);
  }, []);

  const computeView = useCallback(
    (size: Size): View => {
      const canvas = canvasRef.current!;
      const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
      const margin = MARGIN * dpr;
      const bottom = Math.max(MARGIN, toolbarHeight.current + 8) * dpr;
      const fit = fitScale(size);
      const z = zoomRef.current;
      const scale = z.scale ?? fit;
      const width = size.width * scale;
      const height = size.height * scale;
      if (z.scale === null || scale <= fit) {
        return {
          x: Math.round((canvas.width - width) / 2),
          y: Math.round(margin + (canvas.height - margin - bottom - height) / 2),
          width: Math.round(width),
          height: Math.round(height),
        };
      }
      // Keep the photograph covering the stage while panning.
      const clampAxis = (center: number, length: number, stage: number) => {
        if (length <= stage) return (stage - length) / 2;
        return Math.min(0, Math.max(stage - length, stage / 2 - center * length));
      };
      return {
        x: Math.round(clampAxis(z.cx, width, canvas.width)),
        y: Math.round(clampAxis(z.cy, height, canvas.height)),
        width: Math.round(width),
        height: Math.round(height),
      };
    },
    [fitScale],
  );

  const draw = useCallback(() => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas || !r.hasSource) return;
    const frame = frameFor();
    if (!frame) return;
    const s = state.current;
    sizeRef.current = frame.size;
    const view = computeView(frame.size);
    viewRef.current = view;
    r.setTransform(frame.transform);
    const e = effects.current;
    const exposure = s.photo?.recipe.exposure ?? 0;
    const strip: TestStrip | null =
      s.tool === 'test' && s.bands.length ? { count: s.bands.length, start: s.bands[0] - exposure, step: s.testStep } : null;
    r.render(view, {
      // A no-peeking viewfinder is only glass: it shows the scene, never the film.
      split: s.tool === 'compare' ? splitValue.current : s.tool === 'camera' && s.cameraMode === 'blind' ? 2 : -1,
      develop: e.develop,
      lights: e.lights,
      time: e.time,
      strip,
      showBounds: s.tool === 'crop',
      grainSeed: s.tool === 'camera' ? grainSeed.current : [0, 0],
    });
    const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
    const box = frameRef.current;
    if (box) {
      box.style.transform = `translate(${view.x / dpr}px, ${view.y / dpr}px)`;
      box.style.width = `${view.width / dpr}px`;
      box.style.height = `${view.height / dpr}px`;
    }
    const split = splitRef.current;
    if (split) split.style.left = `${splitValue.current * 100}%`;
  }, [computeView, frameFor]);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  // Create the renderer and keep the canvas sized to the stage.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    try {
      rendererRef.current = new FilmRenderer(canvas);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Your browser can’t run the darkroom.');
      return;
    }
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(wrap.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(wrap.clientHeight * dpr));
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();
    const measureTools = new ResizeObserver(() => {
      const tools = toolsRef.current;
      toolbarHeight.current = tools?.firstElementChild ? tools.offsetHeight : 0;
      resize();
    });
    if (toolsRef.current) measureTools.observe(toolsRef.current);
    const onLost = (e: Event) => {
      e.preventDefault();
      setFailed('The graphics card reset. Reload the page to carry on.');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      observer.disconnect();
      measureTools.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  const runDevelop = useCallback(
    (id: string) => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // A tab opened in the background has no one watching the tray, and no animation frames to run it.
      if (reduced || document.hidden) {
        effects.current = { develop: 1, lights: 1, time: 0 };
        markDeveloped(id);
        draw();
        return;
      }
      setDeveloping(true);
      const start = performance.now();
      let lightsAt = start + DEVELOP_MS;
      const finish = () => {
        effects.current = { develop: 1, lights: 1, time: 0 };
        skipRef.current = null;
        setDevelopCaption(null);
        markDeveloped(id);
        draw();
      };
      skipRef.current = () => {
        lightsAt = Math.min(lightsAt, performance.now());
      };
      const tick = (now: number) => {
        const e = effects.current;
        const developed = Math.min(1, (now - start) / DEVELOP_MS);
        e.develop = now >= lightsAt ? 1 : developed;
        e.time = (now - start) / 1000;
        e.lights = now < lightsAt ? 0 : Math.min(1, (now - lightsAt) / LIGHTS_MS);
        if (now >= lightsAt) setDeveloping(false);
        setDevelopCaption(now < lightsAt ? Math.floor(developed * 90) : null);
        draw();
        if (e.lights < 1) animRef.current = requestAnimationFrame(tick);
        else finish();
      };
      effects.current = { develop: 0, lights: 0, time: 0 };
      animRef.current = requestAnimationFrame(tick);
    },
    [draw, markDeveloped, setDeveloping],
  );

  // Load the active photo into the GPU once it is decoded.
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || tool === 'camera' || !photo || photo.status !== 'ready') return;
    const bitmap = getBitmap(photo.id);
    if (!bitmap || loadedRef.current === photo.id) return;
    loadedRef.current = photo.id;
    cancelAnimationFrame(animRef.current);
    r.setSource(bitmap, photo.width, photo.height);
    r.setRecipe(photo.recipe);
    zoomRef.current = { scale: null, cx: 0.5, cy: 0.5 };
    setZoomLabel(null);
    if (!photo.developed) runDevelop(photo.id);
    else {
      effects.current = { develop: 1, lights: 1, time: 0 };
      setDeveloping(false);
      setDevelopCaption(null);
      draw();
    }
  }, [photo, tool, draw, runDevelop, setDeveloping]);

  // Any change to the recipe re-develops instantly.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !photo || !r.hasSource) return;
    if (tool === 'camera' ? !state.current.live : loadedRef.current !== photo.id) return;
    r.setRecipe(photo.recipe);
    schedule();
  }, [photo, photo?.recipe, tool, live, schedule]);

  // Tools take over the whole frame, so they always start from the fitted view.
  useEffect(() => {
    if (tool === 'crop' || tool === 'test' || tool === 'camera') {
      zoomRef.current = { scale: null, cx: 0.5, cy: 0.5 };
      setZoomLabel(null);
    }
    if (tool !== 'compare') splitValue.current = 0.5;
    schedule();
  }, [tool, photo?.geometry, testStep, testCount, cameraMode, schedule]);

  // The camera: every video frame goes straight through the film.
  useEffect(() => {
    if (tool !== 'camera') return;
    const r = rendererRef.current;
    if (!r) return;
    let stopped = false;
    let videoHandle = 0;
    let frameHandle = 0;
    let frames = 0;
    let lastGrain = 0;
    let liveVideo: HTMLVideoElement | null = null;
    const slowDevice = window.matchMedia('(pointer: coarse)').matches;

    setLive(null);
    setCameraError(null);
    cancelAnimationFrame(animRef.current);
    effects.current = { develop: 1, lights: 1, time: 0 };
    setDeveloping(false);
    setDevelopCaption(null);
    loadedRef.current = null;
    r.clear();

    openCamera(facing)
      .then((camera) => {
        if (stopped) return;
        liveVideo = camera.video;
        r.setSource(camera.video, camera.width, camera.height, { live: true });
        const current = state.current.photo;
        if (current) r.setRecipe(current.recipe);
        // Read straight away by draw(), before React has re-rendered with the new state.
        state.current.live = camera;
        setLive(camera);
        const onFrame = (now: number) => {
          if (stopped) return;
          frames++;
          r.updateSource(camera.video, { bleed: !slowDevice || frames % 2 === 0 });
          // Film runs at 24 frames a second, and every frame has its own grain.
          if (now - lastGrain >= 41) {
            grainSeed.current = [Math.random(), Math.random()];
            lastGrain = now;
          }
          draw();
          next();
        };
        const next = () => {
          if (typeof camera.video.requestVideoFrameCallback === 'function') {
            videoHandle = camera.video.requestVideoFrameCallback(onFrame);
          } else {
            frameHandle = requestAnimationFrame(onFrame);
          }
        };
        next();
      })
      .catch((err: Error) => {
        if (!stopped) setCameraError(err.message);
      });

    return () => {
      stopped = true;
      if (liveVideo && videoHandle) liveVideo.cancelVideoFrameCallback?.(videoHandle);
      cancelAnimationFrame(frameHandle);
      closeCamera();
      state.current.live = null;
      setLive(null);
      grainSeed.current = [0, 0];
      loadedRef.current = null;
    };
    // The film and exposure reach the running loop through the recipe effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, facing]);

  // Pointer: drag to pan when zoomed, double-click to inspect grain at 100%, wheel to zoom.
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const canZoom = () => {
    const t = state.current.tool;
    return !!rendererRef.current?.hasSource && (t === null || t === 'compare');
  };

  const setZoom = useCallback(
    (scale: number | null, anchorX?: number, anchorY?: number) => {
      const canvas = canvasRef.current!;
      const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
      const view = viewRef.current;
      const z = zoomRef.current;
      if (anchorX !== undefined && anchorY !== undefined) {
        z.cx = Math.max(0, Math.min(1, (anchorX * dpr - view.x) / view.width));
        z.cy = Math.max(0, Math.min(1, (anchorY * dpr - view.y) / view.height));
      }
      z.scale = scale;
      setZoomLabel(scale === null ? null : `${Math.round(scale * 100)}%`);
      schedule();
    },
    [schedule],
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!canZoom()) return;
      e.preventDefault();
      const fit = fitScale(sizeRef.current);
      const current = zoomRef.current.scale ?? fit;
      const next = current * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016));
      const rect = canvas.getBoundingClientRect();
      if (next <= fit * 1.01) setZoom(null);
      else setZoom(Math.min(next, 4), e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [fitScale, setZoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    skipRef.current?.();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pointer.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) p.moved = true;
    p.x = e.clientX;
    p.y = e.clientY;
    const canvas = canvasRef.current!;
    const dpr = canvas.width / Math.max(canvas.clientWidth, 1);
    const z = zoomRef.current;
    if (z.scale !== null) {
      const view = viewRef.current;
      z.cx = Math.max(0, Math.min(1, z.cx - (dx * dpr) / view.width));
      z.cy = Math.max(0, Math.min(1, z.cy - (dy * dpr) / view.height));
      schedule();
    }
  };
  const onPointerUp = () => {
    pointer.current = null;
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (!canZoom()) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    if (zoomRef.current.scale === null) setZoom(1, e.clientX - rect.left, e.clientY - rect.top);
    else setZoom(null);
  };

  const onSplitDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const frame = frameRef.current!;
    const move = (ev: PointerEvent) => {
      const rect = frame.getBoundingClientRect();
      splitValue.current = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      schedule();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onSplitKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') splitValue.current = Math.max(0, splitValue.current - 0.02);
    else if (e.key === 'ArrowRight') splitValue.current = Math.min(1, splitValue.current + 0.02);
    else return;
    e.preventDefault();
    e.stopPropagation();
    schedule();
  };

  const showHint = !hasOwnPhotos && tool === null && !zoomLabel && developCaption === null && photo?.status === 'ready';
  const showPhotoMessages = tool !== 'camera';

  return (
    <div className="stage" ref={wrapRef} data-zoomed={zoomLabel !== null}>
      <canvas
        ref={canvasRef}
        className="stage__canvas"
        role="img"
        aria-label={
          tool === 'camera'
            ? 'Live camera view'
            : photo
              ? `${photo.name}, developed on ${getStock(photo.recipe.stock).name}. Double-click to inspect at 100%.`
              : 'No photo loaded'
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      <div className="stage__frame" ref={frameRef}>
        {tool === 'compare' && (
          <div
            className="split"
            ref={splitRef}
            style={{ left: `${splitValue.current * 100}%` }}
            onPointerDown={onSplitDown}
            onKeyDown={onSplitKey}
            role="slider"
            tabIndex={0}
            aria-label="Before and after divider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(splitValue.current * 100)}
          >
            <span className="split__label split__label--left">Original</span>
            <span className="split__handle" />
            <span className="split__label split__label--right">Developed</span>
          </div>
        )}
        {tool === 'crop' && photo && <CropOverlay photo={photo} />}
        {tool === 'test' && photo && <TestStripBands bands={bands} exposure={photo.recipe.exposure} />}
        {tool === 'camera' && live && cameraMode === 'blind' && <ViewfinderMarks />}
      </div>

      {developCaption !== null && (
        <div className="develop-caption" aria-live="polite">
          <span className="develop-caption__time">0:{String(developCaption).padStart(2, '0')}</span>
          <span>In the developer. Click to skip.</span>
        </div>
      )}
      {showHint && (
        <button className="sample-hint" onClick={() => document.getElementById('file-input')?.click()}>
          <Icon name="plus" size={13} />
          <span className="only-wide">Sample photo. Drop your own anywhere, or click to open one.</span>
          <span className="only-phone">Sample photo. Tap to open your own.</span>
        </button>
      )}
      {zoomLabel && (
        <button className="zoom-chip" onClick={() => setZoom(null)} aria-label="Fit photo to window">
          {zoomLabel} · Fit
        </button>
      )}

      <div className="stage__tools" ref={toolsRef}>
        {tool === 'crop' && photo && <CropBar photo={photo} />}
        {tool === 'test' && <TestStripBar step={testStep} onStep={setTestStep} />}
        {tool === 'camera' && (
          <CameraBar
            live={live}
            error={cameraError}
            onSwitch={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
            getVideo={() => getLiveCamera()}
          />
        )}
      </div>

      {tool === 'camera' && !live && !cameraError && <div className="stage__message">Starting the camera…</div>}
      {tool === 'camera' && cameraError && (
        <div className="stage__message stage__message--error" role="alert">
          {cameraError}
        </div>
      )}
      {showPhotoMessages && photo?.status === 'loading' && <div className="stage__message">Loading {photo.name}…</div>}
      {showPhotoMessages && photo?.status === 'error' && (
        <div className="stage__message stage__message--error" role="alert">
          {photo.error}
        </div>
      )}
      {failed && (
        <div className="stage__message stage__message--error" role="alert">
          {failed}
        </div>
      )}
      {!photo && !failed && <div className="stage__message">Drop a photo anywhere to begin.</div>}
    </div>
  );
}
