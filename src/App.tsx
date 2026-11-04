import { useEffect, useState } from 'react';
import { accentFor } from './lib/accent';
import { decodeRecipe } from './lib/recipe';
import { getStock, STOCKS } from './lib/stocks';
import { useActivePhoto, useStore } from './state/store';
import { ExportSheet } from './components/ExportSheet';
import { FilmStrip } from './components/FilmStrip';
import { HelpSheet } from './components/HelpSheet';
import { Icon } from './components/Icon';
import { Panel } from './components/Panel';
import { Roll } from './components/Roll';
import { Stage } from './components/Stage';
import { TopBar } from './components/TopBar';

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return (el as HTMLInputElement).type !== 'range';
  return el.tagName === 'TEXTAREA' || el.isContentEditable;
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (isTyping(e.target) || s.overlay) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (s.tool === 'crop') {
        if (key === 'escape') s.finishCrop(false);
        else if ((key === 'enter' && !(e.target instanceof HTMLButtonElement)) || (key === 'k' && !mod)) s.finishCrop(true);
        return;
      }
      if (key === 'escape' && s.tool) {
        s.setTool(null);
        return;
      }
      if (s.developing) return;
      if (s.tool === 'camera') {
        const filmLocked = s.camera.mode === 'blind' && s.camera.shots.length > 0;
        if (key === 'v') s.setTool(null);
        if (filmLocked || (key !== 'arrowleft' && key !== 'arrowright')) return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod || e.altKey) return;
      const photo = s.photos.find((p) => p.id === s.activeId);
      const target = e.target instanceof HTMLElement ? e.target : null;
      const onRange = target?.tagName === 'INPUT';
      if (key === 'arrowleft' || key === 'arrowright') {
        if (onRange || target?.getAttribute('role') === 'slider' || !photo) return;
        e.preventDefault();
        const i = STOCKS.findIndex((x) => x.id === photo.recipe.stock);
        const next = STOCKS[(i + (key === 'arrowright' ? 1 : -1) + STOCKS.length) % STOCKS.length];
        s.setRecipe({ stock: next.id }, true);
      } else if (key === 'arrowup' || key === 'arrowdown') {
        if (onRange) return;
        e.preventDefault();
        const i = s.photos.findIndex((p) => p.id === s.activeId);
        const next = s.photos[(i + (key === 'arrowdown' ? 1 : -1) + s.photos.length) % s.photos.length];
        if (next) s.activate(next.id);
      } else if (key === 'c' && !e.repeat && photo?.status === 'ready') {
        s.setTool(s.tool === 'compare' ? null : 'compare');
      } else if (key === 'k' && !e.repeat && photo?.status === 'ready') {
        s.setTool('crop');
      } else if (key === 't' && !e.repeat && photo?.status === 'ready') {
        s.setTool(s.tool === 'test' ? null : 'test');
      } else if (key === 'v' && !e.repeat) {
        s.setTool('camera');
      } else if (key === 'r') {
        s.resetRecipe();
      } else if (key === 'e' && photo?.status === 'ready') {
        s.setOverlay('export');
      } else if (key === '?') {
        s.setOverlay('help');
      } else if (key === 'z') {
        document.querySelector('.stage__canvas')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: window.innerWidth * 0.42, clientY: window.innerHeight * 0.42 }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useFileIntake() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      useStore.getState().addFiles([...(e.dataTransfer?.files ?? [])]);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        useStore.getState().addFiles(files);
        return;
      }
      const recipe = decodeRecipe(e.clipboardData?.getData('text') ?? '');
      if (recipe) {
        useStore.getState().setRecipe(recipe, true);
        useStore.getState().showToast(`Recipe applied: ${getStock(recipe.stock).name}`);
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
  return dragging;
}

export function App() {
  const init = useStore((s) => s.init);
  const overlay = useStore((s) => s.overlay);
  const developing = useStore((s) => s.developing);
  const toast = useStore((s) => s.toast);
  const mobileTab = useStore((s) => s.mobileTab);
  const tool = useStore((s) => s.tool);
  const setMobileTab = useStore((s) => s.setMobileTab);
  const photo = useActivePhoto();
  const dragging = useFileIntake();
  useShortcuts();

  useEffect(() => {
    init();
  }, [init]);

  const stock = photo ? getStock(photo.recipe.stock) : null;
  const accent = stock ? accentFor(stock.box, stock.boxInk) : undefined;

  return (
    <div className="app" data-room={developing ? 'safelight' : 'lit'} data-tab={mobileTab} data-tool={tool ?? 'none'} style={accent ? { ['--accent' as string]: accent } : undefined}>
      <TopBar />
      <Roll />
      <main className="main">
        <Stage />
      </main>
      <FilmStrip />
      <Panel />
      <nav className="tabs" aria-label="Sections">
        {(
          [
            ['film', 'film', 'Film'],
            ['adjust', 'sliders', 'Adjust'],
            ['roll', 'photo', 'Photos'],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={mobileTab === id ? 'is-on' : ''} onClick={() => setMobileTab(id)} aria-pressed={mobileTab === id}>
            <Icon name={icon} />
            {label}
          </button>
        ))}
      </nav>
      {overlay === 'export' && <ExportSheet />}
      {overlay === 'help' && <HelpSheet />}
      {dragging && (
        <div className="drop-veil" aria-hidden="true">
          <div>
            <strong>Drop to load the film</strong>
            <span>Your photos stay on this device.</span>
          </div>
        </div>
      )}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast">{toast}</div>}
      </div>
    </div>
  );
}
