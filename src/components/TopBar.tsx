import { accentFor } from '../lib/accent';
import { outputSize } from '../lib/geometry';
import { getStock } from '../lib/stocks';
import { useActivePhoto, useStore } from '../state/store';
import { Icon } from './Icon';

export function TopBar() {
  const photo = useActivePhoto();
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const reset = useStore((s) => s.resetRecipe);
  const setOverlay = useStore((s) => s.setOverlay);
  const stock = photo ? getStock(photo.recipe.stock) : null;
  const inCamera = tool === 'camera';
  const inCrop = tool === 'crop';
  const editable = !!photo && photo.status === 'ready' && !inCamera;
  const size = photo && photo.status === 'ready' ? outputSize(photo.geometry, photo.width, photo.height) : null;
  const toggle = (name: 'compare' | 'crop' | 'test') => setTool(tool === name ? null : name);

  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="wordmark__lamp" aria-hidden="true" />
        Safelight
      </div>
      <div className="topbar__file">
        {inCamera ? (
          <span className="topbar__name">Camera</span>
        ) : (
          photo && (
            <>
              <span className="topbar__name" title={photo.name}>{photo.name}</span>
              <span className="mono topbar__dims">
                {size ? `${size.width} × ${size.height}` : ''}
                {photo.credit ? ` · Photo: ${photo.credit}` : ''}
              </span>
            </>
          )
        )}
      </div>
      <span className="topbar__privacy">Runs on your device. Nothing is uploaded.</span>
      <div className="topbar__tools">
        <button className="icon-btn hide-phone" onClick={undo} disabled={!photo?.undo.length || inCrop || inCamera} aria-label="Undo" title="Undo (⌘Z)">
          <Icon name="undo" />
        </button>
        <button className="icon-btn hide-phone" onClick={redo} disabled={!photo?.redo.length || inCrop || inCamera} aria-label="Redo" title="Redo (⇧⌘Z)">
          <Icon name="redo" />
        </button>
        <button className="icon-btn hide-phone" onClick={reset} disabled={!editable || inCrop} aria-label="Reset adjustments" title="Reset adjustments (R)">
          <Icon name="reset" />
        </button>
        <span className="topbar__divider" />
        <button className={`btn btn--ghost ${inCrop ? 'is-on' : ''}`} onClick={() => toggle('crop')} aria-pressed={inCrop} disabled={!editable} title="Crop and rotate (K)" aria-label="Crop and rotate">
          <Icon name="crop" size={14} />
          <span className="hide-narrow hide-medium">Crop</span>
        </button>
        <button className={`btn btn--ghost hide-phone ${tool === 'test' ? 'is-on' : ''}`} onClick={() => toggle('test')} aria-pressed={tool === 'test'} disabled={!editable} title="Test strip: compare exposures side by side (T)" aria-label="Test strip">
          <Icon name="strip" size={14} />
          <span className="hide-narrow hide-medium">Test strip</span>
        </button>
        <button className={`btn btn--ghost ${tool === 'compare' ? 'is-on' : ''}`} onClick={() => toggle('compare')} aria-pressed={tool === 'compare'} disabled={!editable} title="Compare with the original (C)" aria-label="Before and after">
          <Icon name="compare" size={14} />
          <span className="hide-narrow hide-medium">Before / after</span>
        </button>
        <button className="icon-btn hide-phone" onClick={() => setOverlay('help')} aria-label="Help and shortcuts" title="Help (?)">
          <Icon name="help" />
        </button>
        <button
          className="btn btn--primary"
          onClick={() => setOverlay('export')}
          disabled={!editable || inCrop}
          style={stock ? { background: accentFor(stock.box, stock.boxInk), color: stock.box === accentFor(stock.box, stock.boxInk) ? stock.boxInk : stock.box } : undefined}
          title="Export (E)"
        >
          <Icon name="download" size={14} />
          Export
        </button>
      </div>
    </header>
  );
}
