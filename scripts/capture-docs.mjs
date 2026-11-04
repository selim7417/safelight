// Captures the README images from the real production build, on the real GPU.
// Run with: npm run docs  (needs ffmpeg for the GIF; the Metal flag below is for macOS)
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const OUT = await mkdtemp(join(tmpdir(), 'safelight-docs-'));
const require = createRequire(join(ROOT, 'package.json'));
const sharp = require('sharp');
const DIST = join(ROOT, 'dist');
const DOCS = join(ROOT, 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(DIST, path === '/' ? 'index.html' : decodeURIComponent(path));
  try { await stat(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file)); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] });
{
  const probe = await browser.newPage();
  console.log('GPU:', await probe.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
  await probe.close();
}

// Stills, with the reveal already finished.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce', acceptDownloads: true });
const page = await ctx.newPage();
await page.goto(URL_);
await page.waitForSelector('.sample-hint', { timeout: 30000 });
await page.waitForTimeout(1500);
await sharp(await page.screenshot()).resize({ width: 1800 }).jpeg({ quality: 86, mozjpeg: true }).toFile(join(DOCS, 'hero.jpg'));

// One photo through every stock, from the app's own film strip.
await page.click('.roll__item:nth-child(2) button');
await page.waitForFunction(() => document.querySelector('.topbar__name').textContent === 'Lake');
await page.waitForTimeout(1800);
const frames = await page.evaluate(() => [...document.querySelectorAll('.frame')].map((f) => ({ name: f.querySelector('.frame__label').textContent, url: f.querySelector('canvas').toDataURL('image/png') })));
const W = 300, H = 200, GAP = 6, COLS = 5;
const rows = Math.ceil(frames.length / COLS);
const composites = [];
for (let i = 0; i < frames.length; i++) {
  const x = GAP + (i % COLS) * (W + GAP);
  const y = GAP + Math.floor(i / COLS) * (H + 22 + GAP);
  composites.push({ input: Buffer.from(frames[i].url.split(',')[1], 'base64'), left: x, top: y });
  composites.push({ input: Buffer.from(`<svg width="${W}" height="20"><text x="0" y="14" font-family="Helvetica, Arial" font-size="13" fill="#e8963a">${frames[i].name}</text></svg>`), left: x, top: y + H + 2 });
}
await sharp({ create: { width: GAP + COLS * (W + GAP), height: GAP + rows * (H + 22 + GAP), channels: 3, background: '#0b0907' } }).composite(composites).jpeg({ quality: 86, mozjpeg: true }).toFile(join(DOCS, 'stocks.jpg'));

// The crop tool.
await page.click('button[aria-label="Crop and rotate"]');
await page.waitForSelector('.crop__box');
await page.click('.crop-bar__shapes button:has-text("4:5")');
await page.locator('#crop-angle').fill('-3.5');
await page.waitForTimeout(700);
await sharp(await page.locator('.main').screenshot()).resize({ width: 1400 }).jpeg({ quality: 86, mozjpeg: true }).toFile(join(DOCS, 'crop.jpg'));
await page.keyboard.press('Escape');

// The test strip.
await page.click('.roll__item:nth-child(6) button');
await page.waitForFunction(() => document.querySelector('.topbar__name').textContent === 'Taxis');
await page.waitForTimeout(1200);
await page.keyboard.press('t');
await page.waitForSelector('.test-strip');
await page.waitForTimeout(700);
await sharp(await page.locator('.main').screenshot()).resize({ width: 1400 }).jpeg({ quality: 86, mozjpeg: true }).toFile(join(DOCS, 'test-strip.jpg'));
await page.keyboard.press('Escape');

// Before and after.
await page.click('.roll__item:nth-child(5) button');
await page.waitForFunction(() => document.querySelector('.topbar__name').textContent === 'Café');
await page.waitForTimeout(1200);
await page.click('button:has-text("Before / after")');
await page.waitForSelector('.split');
await page.waitForTimeout(800);
await sharp(await page.locator('.stage').screenshot()).resize({ width: 1400 }).jpeg({ quality: 86, mozjpeg: true }).toFile(join(DOCS, 'compare.jpg'));
await page.keyboard.press('c');

// A real exported film scan, of a different photo.
await page.click('.roll__item:nth-child(4) button');
await page.waitForFunction(() => document.querySelector('.topbar__name').textContent === 'Light trails');
await page.waitForTimeout(1000);
await page.click('button:has-text("Export")');
await page.waitForSelector('.export');
await page.click('label.choice:has-text("Film scan")');
await page.click('.segmented button:has-text("2048 px")');
await page.waitForTimeout(300);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('button:has-text("Save this photo")')]);
await dl.saveAs(join(DOCS, 'film-scan.jpg'));
await ctx.close();

// Phone.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
const mob = await phone.newPage();
await mob.goto(URL_);
await mob.waitForSelector('.sample-hint', { timeout: 30000 });
await mob.waitForTimeout(1500);
await sharp(await mob.screenshot()).jpeg({ quality: 84, mozjpeg: true }).toFile(join(DOCS, 'phone.jpg'));
await phone.close();

// The reveal, stepped frame by frame on a fake clock so a slow software GPU can still record it smoothly.
const framesDir = join(OUT, 'reveal');
await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
const vid = await browser.newContext({ viewport: { width: 1120, height: 700 } });
const v = await vid.newPage();
await v.clock.install();
await v.goto(URL_);
await v.clock.pauseAt(Date.now() + 2000);
let began = false;
for (let i = 0; i < 2000 && !began; i++) {
  await v.clock.runFor(16);
  began = await v.evaluate(() => document.querySelector('.app')?.dataset.room === 'safelight');
  await new Promise((r) => setTimeout(r, 12));
}
console.log('reveal began:', began);
let n = 0;
for (let ms = 0; ms < 4000; ms += 66) {
  await v.clock.runFor(66);
  await v.screenshot({ path: join(framesDir, `f${String(n++).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 86 });
}
await vid.close();
console.log('reveal frames', n);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '15', '-i', join(framesDir, 'f%03d.jpg'), '-vf', 'fps=15,scale=840:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', join(DOCS, 'develop.gif')]);

await browser.close();
server.close();
