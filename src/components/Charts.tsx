import { useEffect, useMemo, useRef } from 'react';
import { LIVE_SOURCE, liveThumbnail, readHistogram, type Histogram } from '../gl/thumbnails';
import { getLiveCamera } from '../lib/camera';
import { linearToSrgb } from '../lib/color';
import { channelTransfer, curveStats, STOP } from '../lib/curves';
import { type Recipe } from '../lib/recipe';
import { getStock } from '../lib/stocks';
import { useActivePhoto, useStore } from '../state/store';

const W = 300;
const H = 132;
const PAD = { left: 26, right: 8, top: 8, bottom: 20 };
const STOP_MIN = -8;
const STOP_MAX = 6;

const xFor = (stops: number) => PAD.left + ((stops - STOP_MIN) / (STOP_MAX - STOP_MIN)) * (W - PAD.left - PAD.right);
const yFor = (value: number) => H - PAD.bottom - value * (H - PAD.top - PAD.bottom);

/**
 * The stock's characteristic curve. Horizontal: exposure in stops from mid grey.
 * Vertical: brightness of the print. This is the same data the shader develops the photo with.
 */
export function CurveChart({ recipe }: { recipe: Recipe }) {
  const stock = getStock(recipe.stock);
  const { push, contrast } = recipe;
  const { paths, stats } = useMemo(() => {
    const dev = { push, contrast };
    const channels = stock.mono ? ([1] as const) : ([0, 1, 2] as const);
    const out = channels.map((c) => {
      const f = channelTransfer(stock, c, dev);
      let d = '';
      for (let i = 0; i <= 100; i++) {
        const s = STOP_MIN + ((STOP_MAX - STOP_MIN) * i) / 100;
        d += `${i ? 'L' : 'M'}${xFor(s).toFixed(1)} ${yFor(linearToSrgb(Math.max(0, Math.min(1, f(s * STOP))))).toFixed(1)}`;
      }
      return { c, d };
    });
    return { paths: out, stats: curveStats(stock, dev) };
  }, [stock, push, contrast]);

  const COLORS = ['#ff6a55', '#63d58a', '#6aa6ff'];
  return (
    <figure className="chart">
      <figcaption className="chart__caption">
        <span>Characteristic curve</span>
        <span className="mono">{stats.latitude.toFixed(0)} stops · γ {stats.contrast.toFixed(2)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Characteristic curve of ${stock.name}. Latitude ${stats.latitude.toFixed(0)} stops, contrast ${stats.contrast.toFixed(2)}.`}>
        {[-6, -4, -2, 0, 2, 4].map((s) => (
          <g key={s}>
            <line className={s === 0 ? 'chart__axis' : 'chart__grid'} x1={xFor(s)} x2={xFor(s)} y1={PAD.top} y2={H - PAD.bottom} />
            <text className="chart__tick" x={xFor(s)} y={H - 7} textAnchor="middle">
              {s > 0 ? `+${s}` : s < 0 ? `−${-s}` : '0'}
            </text>
          </g>
        ))}
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line className="chart__grid" x1={PAD.left} x2={W - PAD.right} y1={yFor(v)} y2={yFor(v)} />
            <text className="chart__tick" x={PAD.left - 5} y={yFor(v) + 3} textAnchor="end">
              {v * 100}
            </text>
          </g>
        ))}
        {paths.map(({ c, d }) => (
          <path key={c} d={d} fill="none" stroke={stock.mono ? 'var(--ink)' : COLORS[c]} strokeWidth={1.5} strokeLinejoin="round" style={{ mixBlendMode: 'screen' }} />
        ))}
      </svg>
      <div className="chart__axis-label">Exposure, stops from mid grey</div>
    </figure>
  );
}

export function HistogramChart() {
  const photo = useActivePhoto();
  const ref = useRef<HTMLCanvasElement>(null);
  const recipe = photo?.recipe;
  const thumb = photo?.thumb;
  const id = photo?.id;
  const geometry = photo?.geometry;
  const tool = useStore((s) => s.tool);

  useEffect(() => {
    if (!recipe) return;
    const paint = (hist: Histogram) => {
      const canvas = ref.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      // Ignore the end bins when scaling, so clipping doesn't flatten the rest of the graph.
      let peak = 1;
      for (let i = 1; i < 63; i++) peak = Math.max(peak, hist.r[i], hist.g[i], hist.b[i]);
      const draw = (bins: Uint32Array, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let i = 0; i < bins.length; i++) {
          const x = (i / (bins.length - 1)) * width;
          ctx.lineTo(x, height - Math.min(1, Math.sqrt(bins[i] / peak)) * (height - 1));
        }
        ctx.lineTo(width, height);
        ctx.closePath();
        ctx.fill();
      };
      ctx.globalCompositeOperation = 'lighter';
      draw(hist.r, 'rgba(255,74,58,0.72)');
      draw(hist.g, 'rgba(62,214,110,0.72)');
      draw(hist.b, 'rgba(70,132,255,0.72)');
    };
    if (tool === 'camera') {
      // A live meter: twice a second is plenty, and the film strip is already feeding it frames.
      const meter = window.setInterval(() => {
        const frame = liveThumbnail();
        if (frame && getLiveCamera()) paint(readHistogram(LIVE_SOURCE, frame, recipe));
      }, 500);
      return () => window.clearInterval(meter);
    }
    if (!thumb || !id || tool === 'crop') return;
    const timer = window.setTimeout(() => paint(readHistogram(id, thumb, recipe, geometry)), 60);
    return () => window.clearTimeout(timer);
  }, [thumb, recipe, id, geometry, tool]);

  return (
    <figure className="chart">
      <figcaption className="chart__caption">
        <span>Histogram</span>
        <span className="chart__ends mono">shadows – highlights</span>
      </figcaption>
      <canvas ref={ref} className="histogram" width={600} height={92} role="img" aria-label="Brightness histogram of the developed photo" />
    </figure>
  );
}
