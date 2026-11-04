import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasToBlob, composePrint, type BorderStyle } from '../gl/print';
import { FilmRenderer } from '../gl/renderer';
import { getThumbRenderer } from '../gl/thumbnails';
import { frameToSource, outputSize } from '../lib/geometry';
import { fitLongEdge } from '../lib/images';
import { getStock } from '../lib/stocks';
import { createZip, uniqueFileNames } from '../lib/zip';
import { decodePhoto, rollOf, useActivePhoto, useStore, type Photo } from '../state/store';
import { Icon } from './Icon';

type Format = 'jpeg' | 'png';
const SIZES = [
  { id: 'full', label: 'Full size', edge: Infinity },
  { id: 'web', label: '2048 px', edge: 2048 },
  { id: 'social', label: '1080 px', edge: 1080 },
] as const;
const BORDERS: { id: BorderStyle; label: string; hint: string }[] = [
  { id: 'none', label: 'None', hint: 'Just the photo' },
  { id: 'print', label: 'Darkroom print', hint: 'Fibre paper with a filed-out black keyline' },
  { id: 'rebate', label: 'Film scan', hint: 'Sprocket holes and edge markings' },
];

let exportRenderer: FilmRenderer | null = null;

interface HostDownloads {
  save(request: { filename: string; data: Blob }): Promise<unknown>;
}

interface EmbeddingHost {
  use?: (capability: string) => Promise<unknown>;
}

/**
 * Hands a finished file to the viewer. Some hosts embed the page in a frame that blocks downloads and
 * offer their own save prompt instead. Everywhere else this is an ordinary browser download.
 * Resolves false only when the viewer turned the save down.
 */
async function saveBlob(blob: Blob, name: string): Promise<boolean> {
  const host = (window as unknown as { claude?: EmbeddingHost }).claude;
  const downloads = host?.use ? ((await host.use('downloads').catch(() => null)) as HostDownloads | null) : null;
  if (downloads) {
    try {
      await downloads.save({ filename: name, data: blob });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'declined') return false;
      // The prompt isn't available in this view: fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

async function developFile(photo: Photo, frameNumber: number, edge: number, border: BorderStyle, format: Format): Promise<Blob> {
  exportRenderer ??= new FilmRenderer(document.createElement('canvas'), { readback: true });
  const bitmap = await decodePhoto(photo);
  try {
    exportRenderer.setSource(bitmap, bitmap.width, bitmap.height);
    const full = outputSize(photo.geometry, bitmap.width, bitmap.height);
    const size = fitLongEdge(full.width, full.height, Math.min(edge, exportRenderer.maxTexture));
    const transform = frameToSource(photo.geometry, bitmap.width, bitmap.height);
    const canvas = composePrint(exportRenderer, photo.recipe, transform, size.width, size.height, border, frameNumber);
    return await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.94);
  } finally {
    bitmap.close();
    exportRenderer.releaseSource();
  }
}

export function ExportSheet() {
  const photo = useActivePhoto();
  const allPhotos = useStore((s) => s.photos);
  const photos = useMemo(() => rollOf(allPhotos), [allPhotos]);
  const setOverlay = useStore((s) => s.setOverlay);
  const showToast = useStore((s) => s.showToast);
  const [format, setFormat] = useState<Format>('jpeg');
  const [sizeId, setSizeId] = useState<(typeof SIZES)[number]['id']>('full');
  const [border, setBorder] = useState<BorderStyle>('none');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const edge = SIZES.find((s) => s.id === sizeId)!.edge;
  const stock = photo ? getStock(photo.recipe.stock) : null;
  const output = useMemo(() => {
    if (!photo) return null;
    const full = outputSize(photo.geometry, photo.width, photo.height);
    return fitLongEdge(full.width, full.height, edge);
  }, [photo, edge]);
  const frameNumber = photo ? Math.max(1, allPhotos.indexOf(photo) + 1) : 1;

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOverlay]);

  // Live preview of the print at a small size, using the same composer as the final file.
  useEffect(() => {
    if (!photo?.thumb || !previewRef.current) return;
    const renderer = getThumbRenderer(photo.id, photo.thumb);
    const full = outputSize(photo.geometry, photo.thumb.width, photo.thumb.height);
    const size = fitLongEdge(full.width, full.height, 520);
    const transform = frameToSource(photo.geometry, photo.thumb.width, photo.thumb.height);
    const canvas = composePrint(renderer, photo.recipe, transform, size.width, size.height, border, frameNumber);
    previewRef.current.replaceChildren(canvas);
  }, [photo, border, frameNumber]);

  useEffect(() => {
    setResult((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
  }, [format, sizeId, border, photo?.recipe, photo?.geometry]);

  if (!photo || !stock || !output) return null;
  const extension = format === 'png' ? 'png' : 'jpg';
  const suffix = ` ${stock.name}`;

  const exportOne = async () => {
    setBusy('Developing…');
    setError(null);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const blob = await developFile(photo, frameNumber, edge, border, format);
      const [name] = uniqueFileNames([photo.name], suffix, extension);
      setResult({ url: URL.createObjectURL(blob), name, bytes: blob.size });
      if (await saveBlob(blob, name)) showToast(`Saved ${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Try a smaller size.');
    } finally {
      setBusy(null);
    }
  };

  const exportRoll = async () => {
    setError(null);
    try {
      const names = uniqueFileNames(photos.map((p) => p.name), '', extension);
      const entries = [];
      for (let i = 0; i < photos.length; i++) {
        setBusy(`Developing ${i + 1} of ${photos.length}…`);
        await new Promise((r) => setTimeout(r, 16));
        const blob = await developFile(photos[i], i + 1, edge, border, format);
        entries.push({ name: names[i], data: new Uint8Array(await blob.arrayBuffer()) });
      }
      const zip = new Blob([createZip(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
      if (await saveBlob(zip, 'Safelight roll.zip')) showToast(`Saved ${photos.length} photos as Safelight roll.zip`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Try a smaller size.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && setOverlay(null)}>
      <div className="sheet export" role="dialog" aria-modal="true" aria-label="Export" ref={dialogRef}>
        <button className="icon-btn sheet__close" onClick={() => setOverlay(null)} aria-label="Close">
          <Icon name="close" />
        </button>
        <div className="export__preview">
          <div className="export__picture" ref={previewRef} hidden={!!result} />
          {result && <img className="export__result" src={result.url} alt={`Finished print: ${result.name}`} />}
          {result && (
            <p className="export__saved">
              <Icon name="check" size={13} />
              <span>
                {result.name}, {(result.bytes / 1048576).toFixed(1)} MB. No download? Right-click or long-press the picture to save it.
              </span>
            </p>
          )}
        </div>
        <div className="export__options">
          <h2>Make the print</h2>
          <fieldset>
            <legend>Border</legend>
            <div className="choices">
              {BORDERS.map((b) => (
                <label key={b.id} className={`choice ${border === b.id ? 'is-on' : ''}`}>
                  <input type="radio" name="border" value={b.id} checked={border === b.id} onChange={() => setBorder(b.id)} />
                  <span className="choice__label">{b.label}</span>
                  <span className="choice__hint">{b.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Size</legend>
            <div className="segmented">
              {SIZES.map((s) => (
                <button key={s.id} className={sizeId === s.id ? 'is-on' : ''} onClick={() => setSizeId(s.id)} aria-pressed={sizeId === s.id}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="export__dims mono">{output.width} × {output.height} px</p>
          </fieldset>
          <fieldset>
            <legend>Format</legend>
            <div className="segmented">
              <button className={format === 'jpeg' ? 'is-on' : ''} onClick={() => setFormat('jpeg')} aria-pressed={format === 'jpeg'}>JPEG</button>
              <button className={format === 'png' ? 'is-on' : ''} onClick={() => setFormat('png')} aria-pressed={format === 'png'}>PNG</button>
            </div>
          </fieldset>
          <p className="export__privacy">Developed on this device. Location and camera data are removed from the file.</p>
          {error && <p className="export__error" role="alert">{error}</p>}
          <div className="export__actions">
            <button className="btn btn--primary btn--full btn--large" onClick={exportOne} disabled={!!busy}>
              <Icon name="download" size={14} />
              {busy ?? 'Save this photo'}
            </button>
            {photos.length > 1 && (
              <button className="btn btn--ghost btn--full" onClick={exportRoll} disabled={!!busy}>
                Save the whole roll ({photos.length}) as .zip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
