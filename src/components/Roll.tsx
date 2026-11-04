import { useRef } from 'react';
import { useStore, type Photo } from '../state/store';
import { Icon } from './Icon';

/** The roll shows the photo's framing too, so a rotated picture doesn't look unrotated here. */
function previewStyle(photo: Photo): React.CSSProperties | undefined {
  const { quarter, flip } = photo.geometry;
  if (!quarter && !flip) return undefined;
  return { transform: `rotate(${quarter * 90}deg) scale(${quarter % 2 ? 1.34 : 1}) scaleX(${flip ? -1 : 1})` };
}

export function Roll() {
  const photos = useStore((s) => s.photos);
  const activeId = useStore((s) => s.activeId);
  const tool = useStore((s) => s.tool);
  const activate = useStore((s) => s.activate);
  const remove = useStore((s) => s.removePhoto);
  const addFiles = useStore((s) => s.addFiles);
  const setTool = useStore((s) => s.setTool);
  const setMobileTab = useStore((s) => s.setMobileTab);
  const showToast = useStore((s) => s.showToast);
  const input = useRef<HTMLInputElement>(null);
  const inCamera = tool === 'camera';
  let latentNumber = photos.filter((p) => p.latent).length;

  return (
    <nav className="roll" aria-label="Your photos">
      <div className="roll__actions">
        <button className="roll__add" onClick={() => input.current?.click()} title="Open photos. They stay on this device.">
          <Icon name="plus" size={16} />
          <span>Open</span>
        </button>
        <button
          className={`roll__add ${inCamera ? 'is-on' : ''}`}
          onClick={() => {
            setTool(inCamera ? null : 'camera');
            setMobileTab('film');
          }}
          aria-pressed={inCamera}
          title="Shoot through the film, live (V)"
        >
          <Icon name="camera" size={16} />
          <span>Camera</span>
        </button>
      </div>
      <input
        id="file-input"
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <div className="roll__list">
        {photos.map((photo, i) => (
          <div key={photo.id} className={`roll__item ${photo.id === activeId && !inCamera ? 'is-on' : ''}`}>
            {photo.url && !photos[i - 1]?.url && <span className="roll__heading">Samples</span>}
            {photo.latent ? (
              <button
                className="roll__latent"
                onClick={() => showToast('Still in the camera. Develop the roll to see it.')}
                aria-label={`Frame ${latentNumber}, not developed yet`}
              >
                <span>{latentNumber--}</span>
              </button>
            ) : (
              <button onClick={() => activate(photo.id)} aria-label={`Open ${photo.name}`} aria-current={photo.id === activeId && !inCamera} title={photo.name}>
                <img src={photo.previewUrl} alt="" loading="lazy" draggable={false} style={previewStyle(photo)} />
              </button>
            )}
            {!photo.url && !photo.latent && (
              <button className="roll__remove" onClick={() => remove(photo.id)} aria-label={`Remove ${photo.name} from the roll`}>
                <Icon name="close" size={10} />
              </button>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
