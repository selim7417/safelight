import { useEffect, useRef, useState } from 'react';
import { captureFrame, type LiveCamera } from '../lib/camera';
import { ROLL_LENGTH, useStore } from '../state/store';
import { Icon } from './Icon';

/** Framing corners for the no-peeking viewfinder, which has nothing else to look at. */
export function ViewfinderMarks() {
  return (
    <div className="viewfinder" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

export function CameraBar({
  live,
  error,
  onSwitch,
  getVideo,
}: {
  live: LiveCamera | null;
  error: string | null;
  onSwitch: () => void;
  getVideo: () => LiveCamera | null;
}) {
  const mode = useStore((s) => s.camera.mode);
  const shots = useStore((s) => s.camera.shots.length);
  const setCameraMode = useStore((s) => s.setCameraMode);
  const addShot = useStore((s) => s.addShot);
  const setTool = useStore((s) => s.setTool);
  const showToast = useStore((s) => s.showToast);
  const [blink, setBlink] = useState(0);
  const shutter = useRef<HTMLButtonElement>(null);

  const blind = mode === 'blind';
  const left = ROLL_LENGTH - shots;
  const rollFinished = blind && left <= 0;
  const canShoot = !!live && !rollFinished;

  const takeShot = async () => {
    const camera = getVideo();
    if (!camera || rollFinished) return;
    setBlink((n) => n + 1);
    try {
      const { blob, width, height } = await captureFrame(camera.video);
      addShot(blob, width, height, camera.mirrored);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'The shot couldn’t be saved.');
    }
  };
  const latest = useRef(takeShot);
  latest.current = takeShot;

  useEffect(() => {
    shutter.current?.focus();
  }, [live]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code !== 'Space' || e.repeat || target.tagName === 'BUTTON' || target.tagName === 'INPUT') return;
      e.preventDefault();
      void latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="tool-bar camera-bar" role="group" aria-label="Camera">
      {blink > 0 && <span key={blink} className="shutter-blink" aria-hidden="true" />}

      <div className="camera-bar__side">
        <div className="segmented" role="group" aria-label="Viewfinder">
          <button className={!blind ? 'is-on' : ''} onClick={() => setCameraMode('film')} aria-pressed={!blind} disabled={shots > 0} title="See the film live as you shoot">
            Film look
          </button>
          <button className={blind ? 'is-on' : ''} onClick={() => setCameraMode('blind')} aria-pressed={blind} disabled={shots > 0} title={`${ROLL_LENGTH} shots, and you see nothing until you develop the roll`}>
            No peeking
          </button>
        </div>
      </div>

      <button ref={shutter} className="shutter" onClick={() => void takeShot()} disabled={!canShoot} aria-label={rollFinished ? 'Roll finished' : 'Take photo'} title="Take photo (Space)" />

      <div className="camera-bar__side camera-bar__side--end">
        <span className="camera-count" aria-live="polite">
          {blind ? `${Math.max(left, 0)} left` : shots ? `${shots} ${shots === 1 ? 'shot' : 'shots'}` : ''}
        </span>
        {live && live.cameras > 1 && (
          <button className="icon-btn" onClick={onSwitch} aria-label="Switch camera" title="Switch camera">
            <Icon name="switch" />
          </button>
        )}
        <button className={blind && shots > 0 ? 'btn btn--primary' : 'btn btn--ghost'} onClick={() => setTool(null)} title="Close the camera (Esc)">
          {blind && shots > 0 ? `Develop roll (${shots})` : error || !shots ? 'Close' : 'Done'}
        </button>
      </div>
    </div>
  );
}
