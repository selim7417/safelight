// Makes the light copies of the sample photos, so a first-time visitor isn't waiting on full-size files:
// tiny thumbnails for the roll, and a preview the first print can develop from straight away.
// Run with: npm run samples
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, parse } from 'node:path';
import sharp from 'sharp';

const ROOT = 'public/samples';
const TIERS = [
  { dir: 'thumbs', width: 200, quality: 66 },
  { dir: 'preview', width: 1280, quality: 76 },
];

for (const { dir, width, quality } of TIERS) mkdirSync(join(ROOT, dir), { recursive: true });
for (const file of readdirSync(ROOT).filter((f) => f.endsWith('.jpg'))) {
  const source = join(ROOT, file);
  const sizes = [];
  for (const { dir, width, quality } of TIERS) {
    const out = join(ROOT, dir, `${parse(file).name}.webp`);
    await sharp(source).resize({ width }).webp({ quality, effort: 6 }).toFile(out);
    sizes.push(`${dir} ${Math.round(statSync(out).size / 1024)} KB`);
  }
  console.log(`${file.padEnd(20)} full ${Math.round(statSync(source).size / 1024)} KB, ${sizes.join(', ')}`);
}
