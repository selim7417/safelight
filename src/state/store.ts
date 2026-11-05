import { create } from 'zustand';
import { DEFAULT_GEOMETRY, type Geometry } from '../lib/geometry';
import { decodeImage, isImageFile, makeThumb } from '../lib/images';
import { DEFAULT_RECIPE, type Recipe } from '../lib/recipe';

/** One undo step: the look and the framing together. */
export interface Edit {
  recipe: Recipe;
  geometry: Geometry;
}

export interface Photo {
  id: string;
  name: string;
  /** Present for the bundled samples. */
  url?: string;
  /** A light copy to develop from at once, while the full photo downloads behind it. */
  preview?: string;
  /** Whether the full-size photo has replaced the preview. */
  sharp?: boolean;
  file?: File;
  credit?: string;
  previewUrl: string;
  width: number;
  height: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  developed: boolean;
  /** Shot on a no-peeking roll and not developed yet. */
  latent?: boolean;
  recipe: Recipe;
  geometry: Geometry;
  undo: Edit[];
  redo: Edit[];
  thumb?: HTMLCanvasElement;
}

export type Overlay = null | 'export' | 'help';
export type Tool = null | 'compare' | 'crop' | 'test' | 'camera';
export type CameraMode = 'film' | 'blind';

export const ROLL_LENGTH = 36;

interface State {
  photos: Photo[];
  activeId: string | null;
  overlay: Overlay;
  developing: boolean;
  tool: Tool;
  camera: { mode: CameraMode; shots: string[] };
  toast: string | null;
  mobileTab: 'film' | 'adjust' | 'roll';

  init: () => void;
  addFiles: (files: File[]) => void;
  activate: (id: string) => void;
  removePhoto: (id: string) => void;
  /** Change the recipe. With commit, the previous state becomes an undo step. */
  setRecipe: (patch: Partial<Recipe>, commit?: boolean) => void;
  beginEdit: () => void;
  undo: () => void;
  redo: () => void;
  resetRecipe: () => void;
  applyToRoll: () => void;
  markDeveloped: (id: string) => void;
  setDeveloping: (value: boolean) => void;
  setTool: (tool: Tool) => void;
  /** Live while the crop tool is open. The whole session becomes one undo step when it closes. */
  setGeometry: (geometry: Geometry) => void;
  finishCrop: (keep: boolean) => void;
  setCameraMode: (mode: CameraMode) => void;
  addShot: (blob: Blob, width: number, height: number, mirrored: boolean) => void;
  setOverlay: (overlay: Overlay) => void;
  showToast: (message: string) => void;
  setMobileTab: (tab: State['mobileTab']) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const BASE = import.meta.env.BASE_URL;

const SAMPLE = (file: string, name: string, credit: string, stock: string, extra: Partial<Recipe> = {}): Photo => ({
  id: `sample-${file}`,
  name,
  url: `${BASE}samples/${file}.jpg`,
  preview: `${BASE}samples/preview/${file}.webp`,
  previewUrl: `${BASE}samples/thumbs/${file}.webp`,
  credit,
  width: 2400,
  height: 1600,
  status: 'idle',
  developed: true,
  recipe: { ...DEFAULT_RECIPE, stock, ...extra },
  geometry: DEFAULT_GEOMETRY,
  undo: [],
  redo: [],
});

// The tray plays once on arrival and once per batch of the visitor's own photos.
// Stepping through a roll shouldn't mean waiting for each frame to develop.
const SAMPLES: Photo[] = [
  { ...SAMPLE('night-street', 'Night street', 'Rafael Fabricio', 'cine800t'), developed: false },
  SAMPLE('lake', 'Lake', 'Roberto Nickson', 'portrait400'),
  SAMPLE('reader', 'Reader', 'hieu le', 'portrait160'),
  SAMPLE('light-trails', 'Light trails', 'Caleb George', 'cine800t', { exposure: 0.2 }),
  SAMPLE('cafe', 'Café', 'Carli Jean', 'gold200'),
  SAMPLE('taxis', 'Taxis', 'Andrew Ruiz', 'chrome64'),
];

// Full-size bitmaps stay out of React state, and only a few stay decoded at once: 24 MP is about 100 MB.
const bitmaps = new Map<string, ImageBitmap>();
const MAX_DECODED = 3;

export function getBitmap(id: string): ImageBitmap | undefined {
  return bitmaps.get(id);
}

function rememberBitmap(id: string, bitmap: ImageBitmap) {
  bitmaps.delete(id);
  bitmaps.set(id, bitmap);
  while (bitmaps.size > MAX_DECODED) {
    const oldest = bitmaps.keys().next().value as string;
    bitmaps.get(oldest)?.close();
    bitmaps.delete(oldest);
  }
}

export async function decodePhoto(photo: Photo): Promise<ImageBitmap> {
  const source = photo.file ?? photo.url!;
  return decodeImage(source);
}

/** A visitor's own photos are the roll. The samples only count until there are some. */
export function rollOf(photos: Photo[]): Photo[] {
  const own = photos.filter((p) => p.file);
  return own.length ? own : photos;
}

let toastTimer = 0;
const sharpening = new Set<string>();
let cropStart: Geometry | null = null;

const sameGeometry = (a: Geometry, b: Geometry) => JSON.stringify(a) === JSON.stringify(b);

export const useStore = create<State>((set, get) => {
  const patchPhoto = (id: string, patch: Partial<Photo>) =>
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const active = () => {
    const s = get();
    return s.photos.find((p) => p.id === s.activeId);
  };
  const editOf = (p: Photo): Edit => ({ recipe: p.recipe, geometry: p.geometry });

  /** Swaps a preview for the full photo, in the background. Export fetches its own copy if this fails. */
  const sharpen = async (id: string) => {
    if (sharpening.has(id)) return;
    sharpening.add(id);
    try {
      const photo = get().photos.find((p) => p.id === id);
      if (!photo || photo.sharp) return;
      const full = await decodePhoto(photo);
      if (!get().photos.some((p) => p.id === id)) {
        full.close();
        return;
      }
      const previous = bitmaps.get(id);
      rememberBitmap(id, full);
      previous?.close();
      patchPhoto(id, { sharp: true, width: full.width, height: full.height });
    } catch {
      /* The preview stays on screen, which is still a working photo. */
    } finally {
      sharpening.delete(id);
    }
  };

  const load = async (id: string) => {
    const photo = get().photos.find((p) => p.id === id);
    if (!photo) return;
    const light = !!photo.preview && !photo.sharp;
    if (photo.status === 'ready' && bitmaps.has(id)) {
      rememberBitmap(id, bitmaps.get(id)!);
      if (light) void sharpen(id);
      return;
    }
    patchPhoto(id, { status: 'loading', error: undefined });
    try {
      const bitmap = light ? await decodeImage(photo.preview!) : await decodePhoto(photo);
      if (!get().photos.some((p) => p.id === id)) {
        bitmap.close();
        return;
      }
      rememberBitmap(id, bitmap);
      // A preview is smaller than the photo it stands for, so it doesn't change the photo's size.
      patchPhoto(id, {
        status: 'ready',
        width: light ? photo.width : bitmap.width,
        height: light ? photo.height : bitmap.height,
        thumb: photo.thumb ?? makeThumb(bitmap),
      });
      if (light) void sharpen(id);
    } catch {
      const type = photo.file?.name.split('.').pop()?.toUpperCase();
      patchPhoto(id, {
        status: 'error',
        error: `This browser can’t open ${type ? `this ${type} file` : 'that file'}. Convert it to JPEG or PNG and try again.`,
      });
    }
  };

  /** Leaves the camera. A no-peeking roll develops now, starting from its first frame. */
  const leaveCamera = (target?: string) => {
    const { camera, photos, activeId } = get();
    const blind = camera.mode === 'blind' && camera.shots.length > 0;
    const count = camera.shots.length;
    const next = target ?? (count ? (blind ? camera.shots[count - 1] : camera.shots[0]) : activeId);
    set({
      tool: null,
      activeId: next,
      camera: { mode: camera.mode, shots: [] },
      photos: photos.map((p) => (p.latent ? { ...p, latent: false, developed: p.id !== next } : p)),
    });
    if (blind) get().showToast(`Roll developed: ${count} ${count === 1 ? 'photo' : 'photos'}`);
    if (next) void load(next);
  };

  return {
    photos: SAMPLES,
    activeId: SAMPLES[0].id,
    overlay: null,
    developing: false,
    tool: null,
    camera: { mode: 'film', shots: [] },
    toast: null,
    mobileTab: 'film',

    init: () => {
      const id = get().activeId;
      if (id) void load(id);
    },

    addFiles: (files) => {
      const images = files.filter(isImageFile);
      if (!images.length) {
        if (files.length) get().showToast('That isn’t a photo. Try a JPEG, PNG, WebP or AVIF file.');
        return;
      }
      get().setTool(null);
      const lastRecipe = active()?.recipe ?? DEFAULT_RECIPE;
      const added: Photo[] = images.map((file, index) => ({
        id: uid(),
        name: file.name,
        file,
        previewUrl: URL.createObjectURL(file),
        width: 3,
        height: 2,
        status: 'idle',
        developed: index > 0,
        recipe: { ...lastRecipe },
        geometry: DEFAULT_GEOMETRY,
        undo: [],
        redo: [],
      }));
      set((s) => ({ photos: [...added, ...s.photos], activeId: added[0].id }));
      void load(added[0].id);
    },

    activate: (id) => {
      const s = get();
      if (s.tool === 'camera') {
        leaveCamera(id);
        return;
      }
      if (s.activeId === id) return;
      if (s.tool === 'crop') get().finishCrop(true);
      set({ activeId: id, tool: null });
      void load(id);
    },

    removePhoto: (id) => {
      const s = get();
      const index = s.photos.findIndex((p) => p.id === id);
      if (index < 0) return;
      const photo = s.photos[index];
      if (photo.file) URL.revokeObjectURL(photo.previewUrl);
      bitmaps.get(id)?.close();
      bitmaps.delete(id);
      const photos = s.photos.filter((p) => p.id !== id);
      const next = s.activeId === id ? photos[Math.min(index, photos.length - 1)]?.id ?? null : s.activeId;
      set({ photos, activeId: next, camera: { ...s.camera, shots: s.camera.shots.filter((shot) => shot !== id) } });
      if (next && next !== s.activeId && s.tool !== 'camera') void load(next);
    },

    beginEdit: () => {
      const p = active();
      if (p) patchPhoto(p.id, { undo: [...p.undo.slice(-99), editOf(p)], redo: [] });
    },

    setRecipe: (patch, commit = false) => {
      const p = active();
      if (!p) return;
      const recipe = { ...p.recipe, ...patch };
      patchPhoto(p.id, commit ? { recipe, undo: [...p.undo.slice(-99), editOf(p)], redo: [] } : { recipe });
    },

    undo: () => {
      const p = active();
      if (!p || !p.undo.length) return;
      patchPhoto(p.id, { ...p.undo[p.undo.length - 1], undo: p.undo.slice(0, -1), redo: [...p.redo, editOf(p)] });
    },

    redo: () => {
      const p = active();
      if (!p || !p.redo.length) return;
      patchPhoto(p.id, { ...p.redo[p.redo.length - 1], redo: p.redo.slice(0, -1), undo: [...p.undo, editOf(p)] });
    },

    resetRecipe: () => {
      const p = active();
      if (p) get().setRecipe({ ...DEFAULT_RECIPE, stock: p.recipe.stock }, true);
    },

    applyToRoll: () => {
      const p = active();
      if (!p) return;
      const roll = new Set(rollOf(get().photos).map((x) => x.id));
      roll.delete(p.id);
      const others = roll.size;
      // Only the look travels. Each photo keeps its own crop.
      set((s) => ({
        photos: s.photos.map((x) => (roll.has(x.id) ? { ...x, undo: [...x.undo.slice(-99), editOf(x)], redo: [], recipe: { ...p.recipe } } : x)),
      }));
      get().showToast(`Applied this look to ${others} other ${others === 1 ? 'photo' : 'photos'}`);
    },

    markDeveloped: (id) => patchPhoto(id, { developed: true }),
    setDeveloping: (developing) => set({ developing }),

    setTool: (tool) => {
      const s = get();
      if (s.tool === tool) return;
      if (s.tool === 'crop') get().finishCrop(true);
      if (s.tool === 'camera') leaveCamera();
      if (tool === 'crop') cropStart = active()?.geometry ?? null;
      if (tool === 'camera') {
        set({ camera: { mode: get().camera.mode, shots: [] } });
      }
      set({ tool });
    },

    setGeometry: (geometry) => {
      const p = active();
      if (p) patchPhoto(p.id, { geometry });
    },

    finishCrop: (keep) => {
      const p = active();
      if (p && cropStart) {
        if (!keep) patchPhoto(p.id, { geometry: cropStart });
        else if (!sameGeometry(cropStart, p.geometry)) {
          patchPhoto(p.id, { undo: [...p.undo.slice(-99), { recipe: p.recipe, geometry: cropStart }], redo: [] });
        }
      }
      cropStart = null;
      set({ tool: null });
    },

    setCameraMode: (mode) => set((s) => ({ camera: { ...s.camera, mode } })),

    addShot: (blob, width, height, mirrored) => {
      const s = get();
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const number = s.camera.shots.length + 1;
      const file = new File([blob], `Safelight ${stamp} ${number}.jpg`, { type: 'image/jpeg' });
      const photo: Photo = {
        id: uid(),
        name: file.name,
        file,
        previewUrl: URL.createObjectURL(file),
        width,
        height,
        status: 'idle',
        developed: true,
        latent: s.camera.mode === 'blind',
        recipe: { ...(active()?.recipe ?? DEFAULT_RECIPE) },
        // The file holds the true frame. A front camera's mirror is an edit, so it can be undone.
        geometry: { ...DEFAULT_GEOMETRY, flip: mirrored },
        undo: [],
        redo: [],
      };
      set({ photos: [photo, ...s.photos], camera: { ...s.camera, shots: [photo.id, ...s.camera.shots] } });
    },

    setOverlay: (overlay) => set({ overlay }),
    setMobileTab: (mobileTab) => set({ mobileTab }),

    showToast: (toast) => {
      window.clearTimeout(toastTimer);
      set({ toast });
      toastTimer = window.setTimeout(() => set({ toast: null }), 2800);
    },
  };
});

export const useActivePhoto = () => useStore((s) => s.photos.find((p) => p.id === s.activeId) ?? null);
