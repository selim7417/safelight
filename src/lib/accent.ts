function relativeLuminance(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((v >> 16) & 255) + 0.7152 * channel((v >> 8) & 255) + 0.0722 * channel(v & 255);
}

/**
 * The interface takes its accent from the loaded film's box. Dark boxes would vanish against the
 * room, so those use the box's own lettering colour instead.
 */
export function accentFor(box: string, ink: string): string {
  return relativeLuminance(box) < 0.09 ? ink : box;
}
