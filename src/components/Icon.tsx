const PATHS: Record<string, string> = {
  plus: 'M8 3v10M3 8h10',
  crop: 'M4.5 1.5v10h10M1.5 4.5h10v10',
  strip: 'M2 3.5h12v9H2ZM6 3.5v9M10 3.5v9',
  camera: 'M2 5h3l1.2-2h3.6L11 5h3v8H2ZM8 11.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
  rotate: 'M12.5 8a4.5 4.5 0 1 1-1.4-3.3L13 6.5M13 3v3.5H9.5',
  flip: 'M8 2v12M6 4.5 2 11.5h4ZM10 4.5l4 7h-4Z',
  switch: 'M3 6a5 5 0 0 1 9-1.5M13 10a5 5 0 0 1-9 1.5M12.5 2v2.7H9.8M3.5 14v-2.7h2.7',
  close: 'm4 4 8 8M12 4l-8 8',
  undo: 'M5.5 3 2.5 6l3 3M3 6h6.5a3.5 3.5 0 0 1 0 7H6',
  redo: 'M10.5 3l3 3-3 3M13 6H6.5a3.5 3.5 0 0 0 0 7H10',
  compare: 'M8 2v12M3 3.5h3v9H3ZM10 3.5h3v9h-3Z',
  download: 'M8 2.5V10M5 7l3 3 3-3M3 13.5h10',
  copy: 'M5.5 5.5h8v8h-8ZM10.5 5.5v-3h-8v8h3',
  help: 'M6 6a2 2 0 1 1 3 1.7c-.7.4-1 .9-1 1.8M8 12h.01',
  reset: 'M3 8a5 5 0 1 0 1.5-3.5L3 6M3 3v3h3',
  layers: 'M8 2.5 2 6l6 3.5L14 6ZM2 10l6 3.5L14 10',
  photo: 'M2.5 3.5h11v9h-11ZM2.5 10.5l3-3 3 3 2-2 3 3',
  check: 'm3.5 8.5 3 3 6-7',
  sliders: 'M3 2.5v11M8 2.5v11M13 2.5v11M1.5 10h3M6.5 5h3M11.5 11h3',
  film: 'M3 2.5h10v11H3ZM5.5 2.5v11M10.5 2.5v11M3 5h2.5M3 8h2.5M3 11h2.5M10.5 5H13M10.5 8H13M10.5 11H13',
  link: 'M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5A2.5 2.5 0 0 0 9 3.5l-.7.7M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9A2.5 2.5 0 0 0 7 12.5l.7-.7',
};

export function Icon({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
