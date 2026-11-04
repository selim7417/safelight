// The camera. Frames go from the video element straight to the GPU, and a shot is only kept
// in this browser's memory. Nothing here makes a network request.

export type Facing = 'user' | 'environment';

export interface LiveCamera {
  video: HTMLVideoElement;
  stream: MediaStream;
  width: number;
  height: number;
  /** Front cameras are shown like a mirror. */
  mirrored: boolean;
  /** How many cameras the device has, so the switch button can hide when there's only one. */
  cameras: number;
}

export class CameraError extends Error {}

let current: LiveCamera | null = null;
let generation = 0;

export const getLiveCamera = () => current;

function describe(err: unknown): string {
  const name = (err as { name?: string }).name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The camera is blocked. Allow it in your browser’s settings for this site and try again. Some hosted previews can’t use the camera at all, but Safelight’s own site can.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Another app is using the camera. Close it and try again.';
  return 'The camera couldn’t start. Try again.';
}

export async function openCamera(facing: Facing): Promise<LiveCamera> {
  closeCamera();
  const mine = generation;
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) {
    throw new CameraError(
      window.isSecureContext ? 'This browser can’t use the camera.' : 'The camera only works on a secure (https) page.',
    );
  }
  let stream: MediaStream;
  try {
    stream = await devices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (err) {
    throw new CameraError(describe(err));
  }
  const stop = () => stream.getTracks().forEach((t) => t.stop());
  if (mine !== generation) {
    stop();
    throw new CameraError('Cancelled.');
  }

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = stream;
  // Phones won't keep decoding a video that isn't in the page.
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  try {
    await video.play();
    if (!video.videoWidth) {
      await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
    }
  } catch {
    video.remove();
    stop();
    throw new CameraError('The camera couldn’t start. Try again.');
  }
  if (mine !== generation) {
    video.remove();
    stop();
    throw new CameraError('Cancelled.');
  }

  const reported = stream.getVideoTracks()[0]?.getSettings().facingMode;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let cameras = 1;
  try {
    cameras = (await devices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length || 1;
  } catch {
    /* Not knowing only means the switch button stays hidden. */
  }
  if (mine !== generation) {
    video.remove();
    stop();
    throw new CameraError('Cancelled.');
  }
  current = {
    video,
    stream,
    width: video.videoWidth,
    height: video.videoHeight,
    mirrored: reported ? reported === 'user' : !coarse,
    cameras,
  };
  return current;
}

/** Stops the camera, which also turns off the device's camera light. */
export function closeCamera() {
  generation++;
  if (!current) return;
  current.stream.getTracks().forEach((t) => t.stop());
  current.video.srcObject = null;
  current.video.remove();
  current = null;
}

/** Takes the untouched frame. Film is applied afterwards, so the stock can still change later. */
export function captureFrame(video: HTMLVideoElement): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new CameraError('The shot couldn’t be saved.'))),
      'image/jpeg',
      0.95,
    );
  });
}
