import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

// End-to-end test of the production build, with real mouse drags and real downloads.
// Run with: npm run test:e2e  (first time: npx playwright install chromium)
const ROOT = process.cwd();
const OUT = await mkdtemp(join(tmpdir(), 'safelight-e2e-'));
const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join(DIST, path === '/' ? 'index.html' : decodeURIComponent(path));
  try {
    await stat(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// Chromium's built-in test pattern stands in for a real camera.
const FAKE_CAMERA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
// Macs use the real GPU. Elsewhere, including CI, software rendering works but is much slower.
const browser = await chromium.launch(
  process.platform === 'darwin'
    ? { channel: 'chromium', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', ...FAKE_CAMERA] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...FAKE_CAMERA] },
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
const failed = [];
const external = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => failed.push(r.url()));
page.on('request', (r) => { if (!r.url().startsWith(URL_) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });

// ── First visit and the reveal ──
await page.goto(URL_);
await page.waitForSelector('.app[data-room="safelight"]', { timeout: 30000 });
check('opens straight into the developing tray', true);
await page.waitForSelector('.app[data-room="lit"]', { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('.develop-caption'), null, { timeout: 30000 });
await page.waitForTimeout(1600);
check('the room lights come on', true);
check('film box shows the loaded stock', (await page.textContent('.filmbox__name')).trim() === 'Cine');

// ── Film strip, real click ──
const nonBlank = await page.evaluate(() => {
  const c = document.querySelector('.frame[data-stock="pan400"] canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 400) s += d[i];
  return s;
});
check('film strip frames hold real developed thumbnails', nonBlank > 0, `sum ${nonBlank}`);
const mono = await page.evaluate(() => {
  const read = (id) => { const c = document.querySelector(`.frame[data-stock="${id}"] canvas`); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
  const spread = (d) => { let t = 0, k = 0; for (let i = 0; i < d.length; i += 40) { t += Math.abs(d[i] - d[i + 2]); k++; } return t / k; };
  return { bw: spread(read('fine100')), colour: spread(read('gold200')) };
});
check('black and white stocks are neutral, colour stocks are not', mono.bw < 2.5 && mono.colour > 8, JSON.stringify(mono));

await page.click('.frame[data-stock="pan400"]');
await page.waitForFunction(() => document.querySelector('.filmbox__name').textContent.trim() === 'Pan');
check('clicking a frame loads that film', true);
check('selected frame gets the china marker', (await page.$$('.frame.is-on .china-marker')).length === 1);

// ── Slider, real mouse drag ──
const box = await page.locator('#control-exposure').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 6 });
await page.mouse.up();
const ev = await page.locator('.slider:has(#control-exposure) .slider__value').textContent();
check('dragging the exposure slider changes the recipe', ev.includes('+'), ev.trim());
const undoEnabled = await page.isEnabled('button[aria-label="Undo"]');
await page.click('button[aria-label="Undo"]');
const afterUndo = await page.locator('.slider:has(#control-exposure) .slider__value').textContent();
check('one undo reverts the whole drag', undoEnabled && afterUndo.includes('0.00'), afterUndo.trim());

// ── Pixels really change with the film ──
async function stagePixel() {
  await page.waitForTimeout(250);
  const buf = await page.locator('.stage__canvas').screenshot({ type: 'png' });
  return buf.length;
}
const a = await stagePixel();
await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => document.querySelector('.filmbox__name').textContent.trim() === 'Fine');
const b = await stagePixel();
check('arrow key changes stock and the print re-develops', a !== b, `${a} vs ${b} bytes`);

// ── Opening a real photo through the file input ──
await page.setInputFiles('#file-input', [join(ROOT, 'public/samples/lake.jpg')]);
await page.waitForSelector('.app[data-room="safelight"]', { timeout: 15000 });
check('opening your own photo plays the reveal', true);
await page.mouse.click(600, 400);
await page.waitForSelector('.app[data-room="lit"]', { timeout: 8000 });
check('clicking skips the reveal', true);
await page.waitForFunction(() => !document.querySelector('.develop-caption'), null, { timeout: 8000 });
check('your photo keeps the film you had loaded', (await page.textContent('.filmbox__name')).trim() === 'Fine');
check('your photo is listed above the samples', (await page.locator('.roll__item').first().locator('img').getAttribute('src')).startsWith('blob:'));

// ── Compare, real drag ──
await page.click('.frame[data-stock="portrait400"]');
await page.click('button:has-text("Before / after")');
await page.waitForSelector('.split');
const handle = await page.locator('.split').boundingBox();
await page.mouse.move(handle.x + 13, handle.y + 200);
await page.mouse.down();
await page.mouse.move(handle.x - 160, handle.y + 200, { steps: 6 });
await page.mouse.up();
await page.waitForFunction(() => parseFloat(document.querySelector('.split').style.left) < 45, null, { timeout: 5000 }).catch(() => undefined);
const left = await page.evaluate(() => parseFloat(document.querySelector('.split').style.left));
check('the before/after divider follows the mouse', left < 45, `${left}%`);
await page.keyboard.press('c');
await page.waitForFunction(() => !document.querySelector('.split'));
check('C toggles compare', true);

// ── Zoom ──
const stage = await page.locator('.stage__canvas').boundingBox();
await page.mouse.dblclick(stage.x + stage.width / 2, stage.y + stage.height / 2);
await page.waitForSelector('.zoom-chip');
check('double-click inspects at 100%', (await page.textContent('.zoom-chip')).includes('100%'));
await page.click('.zoom-chip');
await page.waitForFunction(() => !document.querySelector('.zoom-chip'));

// ── Export: real downloads ──
await page.click('button:has-text("Export")');
await page.waitForSelector('.export');
await page.waitForTimeout(400);
let [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('button:has-text("Save this photo")')]);
const jpgPath = join(OUT, await dl.suggestedFilename());
await dl.saveAs(jpgPath);
check('exports a file named after the photo and the film', /lake Portrait 400\.jpg/.test(dl.suggestedFilename()), dl.suggestedFilename());
await page.waitForSelector('.export__result');
check('the finished print appears, as a fallback for blocked downloads', true);

await page.click('label.choice:has-text("Film scan")');
await page.click('.segmented button:has-text("2048 px")');
await page.waitForTimeout(300);
[dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('button:has-text("Save this photo")')]);
await dl.saveAs(join(OUT, 'scan.jpg'));

await page.click('label.choice:has-text("Darkroom print")');
await page.click('.segmented button:has-text("PNG")');
await page.waitForTimeout(300);
[dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('button:has-text("Save this photo")')]);
await dl.saveAs(join(OUT, 'print.png'));

check('no whole-roll button when one photo of yours is open', (await page.locator('.export button:has-text("whole roll")').count()) === 0);
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.export'));
check('Escape closes the sheet', true);

// ── Roll of two ──
await page.setInputFiles('#file-input', [join(ROOT, 'public/samples/cafe.jpg'), join(ROOT, 'public/samples/taxis.jpg')]);
await page.waitForSelector('.app[data-room="safelight"]', { timeout: 15000 });
await page.mouse.click(600, 400);
await page.waitForSelector('.app[data-room="lit"]');
await page.waitForFunction(() => !document.querySelector('.develop-caption'));
await page.click('button:has-text("Use this look on the whole roll")');
await page.waitForTimeout(200);
await page.click('button:has-text("Export")');
await page.waitForSelector('.export');
const rollLabel = await page.textContent('.export button:has-text("whole roll")');
check('the roll counts only your photos, not the samples', rollLabel.includes('(3)'), rollLabel.trim());
await page.click('.segmented button:has-text("1080 px")');
[dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('.export button:has-text("whole roll")')]);
await dl.saveAs(join(OUT, 'roll.zip'));
check('the roll downloads as a zip', dl.suggestedFilename() === 'Safelight roll.zip');
const zipReport = execFileSync('unzip', ['-t', join(OUT, 'roll.zip')]).toString();
check('the zip is valid and holds all three photos', /No errors/.test(zipReport) && (zipReport.match(/OK/g) ?? []).length === 3);
await page.keyboard.press('Escape');

// ── Help ──
await page.keyboard.press('?');
await page.waitForSelector('.help');
await page.keyboard.press('Escape');

// ── Every control has a name ──
const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, [role="slider"]')].filter((el) => {
  if (el.type === 'file' || el.hidden) return false;
  const label = el.getAttribute('aria-label') || el.textContent.trim() || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent;
  return !label;
}).map((el) => el.outerHTML.slice(0, 90)));
check('every control has an accessible name', unnamed.length === 0, unnamed.join(' | '));

// ── Offline ──
await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15000 }).catch(() => undefined);
await page.reload();
await page.waitForTimeout(1500);
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.filmbox__name', { timeout: 15000 });
check('works offline after the first visit', (await page.textContent('.wordmark')).includes('Safelight'));
await ctx.setOffline(false);

// ── Phone ──
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
const mob = await phone.newPage();
mob.on('pageerror', (e) => errors.push(`phone: ${e}`));
await mob.goto(URL_);
await mob.waitForSelector('.filmbox__name');
await mob.waitForTimeout(1500);
const overflow = await mob.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
check('phone: no sideways scrolling', overflow.doc <= overflow.win, JSON.stringify(overflow));
const exportBtn = await mob.locator('button:has-text("Export")').boundingBox();
check('phone: Export button fully on screen', exportBtn.x + exportBtn.width <= 390, `right edge ${exportBtn.x + exportBtn.width}`);
check('phone: reduced motion skips the reveal', (await mob.evaluate(() => document.querySelector('.app').dataset.room)) === 'lit');
await mob.tap('.tabs button:has-text("Adjust")');
await mob.waitForSelector('#control-exposure', { state: 'visible' });
await mob.tap('.tabs button:has-text("Photos")');
await mob.waitForSelector('.roll__add', { state: 'visible' });
await mob.tap('.tabs button:has-text("Film")');
await mob.tap('.frame[data-stock="gold200"]');
await mob.waitForFunction(() => document.querySelector('.filmbox__name').textContent.trim() === 'Gold');
check('phone: tapping a frame changes film', true);
await mob.tap('button:has-text("Export")');
await mob.waitForSelector('.export');
const sheet = await mob.locator('.export').boundingBox();
check('phone: export sheet fits the screen width', sheet.width <= 390, `${sheet.width}`);
await phone.close();

// ── First-time visitors ──
const sharp = createRequire(join(ROOT, 'package.json'))('sharp');
{
  const firstCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const f = await firstCtx.newPage();
  const cdp = await firstCtx.newCDPSession(f);
  await cdp.send('Network.enable');
  // 1 Mbit/s, a slow connection. This server doesn't compress, so real hosting is quicker still.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 125000, uploadThroughput: 60000 });
  const requests = [];
  f.on('request', (r) => requests.push(r.url()));
  const started = Date.now();
  await f.goto(URL_, { waitUntil: 'commit' });
  await f.waitForSelector('.app[data-room="safelight"]', { timeout: 45000 });
  const toTray = Date.now() - started;
  check('first visit: the tray opens quickly on a slow connection', toTray < 9000, `${(toTray / 1000).toFixed(1)} s at 1 Mbit/s`);
  const firstRequests = requests.filter((u) => u.includes('/samples/'));
  check('first visit: the first print starts from the light preview', firstRequests.some((u) => u.includes('/preview/night-street.webp')));
  check('first visit: full-size samples aren’t loaded for the roll', !firstRequests.some((u) => /samples\/(lake|reader|light-trails|cafe|taxis)\.jpg/.test(u)), `${firstRequests.length} sample requests`);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await f.waitForSelector('.app[data-room="lit"]', { timeout: 30000 });
  await f.waitForFunction(() => !document.querySelector('.develop-caption'), null, { timeout: 30000 });
  check('first visit: the reveal finishes even as the full photo arrives', true);
  await f.waitForFunction(() => performance.getEntriesByType('resource').some((r) => r.name.endsWith('/samples/night-street.jpg') && r.responseEnd > 0), null, { timeout: 20000 });
  check('first visit: the full photo follows in the background', true);
  const widths = await f.evaluate(() => [...document.querySelectorAll('.roll__item img')].map((i) => i.naturalWidth));
  check('first visit: the roll uses tiny thumbnails', widths.length === 6 && widths.every((w) => w > 0 && w <= 240), widths.join(' '));
  await f.waitForTimeout(500);
  await f.click('button:has-text("Export")');
  await f.waitForSelector('.export');
  const [firstDl] = await Promise.all([f.waitForEvent('download', { timeout: 60000 }), f.click('button:has-text("Save this photo")')]);
  const firstFile = join(OUT, 'sample-full.jpg');
  await firstDl.saveAs(firstFile);
  const firstMeta = await sharp(firstFile).metadata();
  check('first visit: a sample still exports at full size', firstMeta.width === 2400 && firstMeta.height === 1600, `${firstMeta.width}×${firstMeta.height}`);
  await firstCtx.close();
}

// ── Shared helpers for the tools ──
const track = (p, label) => {
  p.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${label}: ${e}`));
  p.on('request', (r) => { if (!r.url().startsWith(URL_) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
};
const COLOUR = ([r, g, b]) => (Math.min(r, g, b) > 170 ? 'white' : r > g && r > b ? 'red' : g > r && g > b ? 'green' : 'blue');

// Four colours, one per corner, so any wrong rotation or mirror shows up as the wrong colour.
const QUADRANTS = join(OUT, 'quadrants.png');
{
  const W = 1200, H = 800, data = Buffer.alloc(W * H * 3);
  const colours = { tl: [230, 30, 30], tr: [30, 200, 40], bl: [40, 60, 230], br: [245, 245, 245] };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = colours[`${y < H / 2 ? 't' : 'b'}${x < W / 2 ? 'l' : 'r'}`];
    data.set(c, (y * W + x) * 3);
  }
  await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toFile(QUADRANTS);
}
const GREY = join(OUT, 'grey.png');
await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 110, g: 110, b: 110 } } }).png().toFile(GREY);

async function corners(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (fx, fy) => {
    const i = (Math.floor(fy * info.height) * info.width + Math.floor(fx * info.width)) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  let opaque = true;
  for (let i = 3; i < data.length; i += info.channels * 97) if (data[i] !== 255) opaque = false;
  return {
    width: info.width,
    height: info.height,
    opaque,
    layout: `${COLOUR(at(0.1, 0.1))} ${COLOUR(at(0.9, 0.1))} ${COLOUR(at(0.1, 0.9))} ${COLOUR(at(0.9, 0.9))}`,
  };
}

// ── Crop and rotate ──
{
  const toolCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true });
  const t = await toolCtx.newPage();
  track(t, 'crop');
  await t.goto(URL_);
  await t.waitForSelector('.sample-hint', { timeout: 30000 });
  await t.setInputFiles('#file-input', [QUADRANTS]);
  await t.waitForFunction(() => document.querySelector('.topbar__name')?.textContent === 'quadrants.png');
  await t.waitForFunction(() => document.querySelector('.topbar__dims')?.textContent.includes('1200 × 800'));
  await t.click('.frame[data-stock="slide100"]');

  const dims = async () => (await t.textContent('.topbar__dims')).trim();
  const exportNow = async (name) => {
    await t.click('button:has-text("Export")');
    await t.waitForSelector('.export');
    const segmented = t.locator('.export .segmented button:has-text("PNG")');
    await segmented.click();
    const [dl] = await Promise.all([t.waitForEvent('download', { timeout: 60000 }), t.click('button:has-text("Save this photo")')]);
    const path = join(OUT, name);
    await dl.saveAs(path);
    await t.keyboard.press('Escape');
    await t.waitForFunction(() => !document.querySelector('.export'));
    return corners(path);
  };
  const openCrop = async () => {
    await t.click('button[aria-label="Crop and rotate"]');
    await t.waitForSelector('.crop__box');
  };
  const undo = async () => {
    await t.click('button[aria-label="Undo"]');
    await t.waitForFunction(() => document.querySelector('.topbar__dims')?.textContent.length > 0);
  };

  let out = await exportNow('as-opened.png');
  check('crop: the exporter keeps an untouched photo the right way up', out.layout === 'red green blue white' && out.width === 1200, out.layout);

  await openCrop();
  check('crop: the tool opens with the whole picture selected', (await t.textContent('.crop__size')).includes('1200 × 800'));
  await t.click('.crop-bar__shapes button:has-text("1:1")');
  check('crop: choosing 1:1 makes the selection square', (await t.textContent('.crop__size')).includes('800 × 800'), await t.textContent('.crop__size'));
  await t.click('.crop-bar button:has-text("Done")');
  await t.waitForFunction(() => !document.querySelector('.crop__box'));
  check('crop: the finished size shows in the title bar', (await dims()).startsWith('800 × 800'), await dims());
  await t.waitForFunction(() => { const r = document.querySelector('.stage__frame').getBoundingClientRect(); return Math.abs(r.width - r.height) <= 2; }, null, { timeout: 3000 }).catch(() => undefined);
  const frameBox = await t.locator('.stage__frame').boundingBox();
  check('crop: the picture on stage is square', Math.abs(frameBox.width - frameBox.height) <= 2, `${frameBox.width} × ${frameBox.height}`);
  out = await exportNow('square.png');
  check('crop: the file is cropped, and the right part of the photo', out.width === 800 && out.height === 800 && out.layout === 'red green blue white', `${out.width}×${out.height} ${out.layout}`);
  await undo();
  check('crop: one undo restores the full frame', (await dims()).startsWith('1200 × 800'), await dims());

  await openCrop();
  await t.click('button[aria-label="Rotate 90 degrees clockwise"]');
  await t.click('.crop-bar button:has-text("Done")');
  check('rotate: width and height swap', (await dims()).startsWith('800 × 1200'), await dims());
  out = await exportNow('rotated.png');
  check('rotate: clockwise, in the file', out.width === 800 && out.height === 1200 && out.layout === 'blue red white green', `${out.width}×${out.height} ${out.layout}`);
  await undo();

  await openCrop();
  await t.click('button[aria-label="Mirror left to right"]');
  await t.click('.crop-bar button:has-text("Done")');
  out = await exportNow('mirrored.png');
  check('mirror: left and right swap, in the file', out.layout === 'green red white blue', out.layout);
  await undo();

  await openCrop();
  await t.locator('#crop-angle').fill('10');
  const tilted = await t.textContent('.crop__size');
  check('straighten: the crop shrinks to avoid empty corners', !tilted.includes('1200 × 800'), tilted.trim());
  await t.waitForTimeout(150);
  await t.click('.crop-bar button:has-text("Done")');
  out = await exportNow('straightened.png');
  check('straighten: the file has no empty corners', out.opaque && out.layout === 'red green blue white', `${out.width}×${out.height} ${out.layout}`);
  await undo();

  await openCrop();
  await t.locator('#crop-angle').fill('10');
  await t.locator('#crop-angle').fill('0');
  check('straighten: levelling back gives the full crop back', (await t.textContent('.crop__size')).includes('1200 × 800'), await t.textContent('.crop__size'));

  const box = await t.locator('.crop__handle--se').boundingBox();
  await t.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await t.mouse.down();
  await t.mouse.move(box.x - 180, box.y - 120, { steps: 5 });
  await t.mouse.up();
  const dragged = await t.textContent('.crop__size');
  check('crop: dragging a corner handle resizes', !dragged.includes('1200 × 800'), dragged.trim());
  const body = await t.locator('.crop__box').boundingBox();
  await t.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await t.mouse.down();
  await t.mouse.move(body.x + body.width / 2 + 70, body.y + body.height / 2 + 40, { steps: 4 });
  await t.mouse.up();
  const moved = await t.locator('.crop__box').boundingBox();
  check('crop: dragging inside moves the selection without resizing', moved.x > body.x + 30 && Math.abs(moved.width - body.width) < 1 && (await t.textContent('.crop__size')) === dragged, `moved ${Math.round(moved.x - body.x)}px`);

  await t.keyboard.press('Escape');
  await t.waitForFunction(() => !document.querySelector('.crop__box'));
  check('crop: Escape cancels and restores the frame', (await dims()).startsWith('1200 × 800'), await dims());
  check('crop: cancelling adds nothing to undo', await t.isDisabled('button[aria-label="Undo"]').then((d) => d === false));

  // A look travels between photos. A crop doesn't.
  await openCrop();
  await t.click('.crop-bar__shapes button:has-text("1:1")');
  await t.click('.crop-bar button:has-text("Done")');
  await t.setInputFiles('#file-input', [GREY]);
  await t.waitForFunction(() => document.querySelector('.topbar__name')?.textContent === 'grey.png');
  await t.waitForFunction(() => document.querySelector('.topbar__dims')?.textContent.includes('1200 × 800'));
  await t.click('.frame[data-stock="pan400"]');
  await t.click('button:has-text("Use this look on the whole roll")');
  await t.click('.roll__item:nth-child(2) button');
  await t.waitForFunction(() => document.querySelector('.topbar__name')?.textContent === 'quadrants.png');
  await t.waitForFunction(() => document.querySelector('.filmbox__name')?.textContent.trim() === 'Pan');
  check('crop: a photo keeps its crop when a look is copied onto it', (await dims()).startsWith('800 × 800'), await dims());

  // ── Test strip ──
  await t.click('.roll__item:nth-child(1) button');
  await t.waitForFunction(() => document.querySelector('.topbar__name')?.textContent === 'grey.png');
  await t.keyboard.press('t');
  await t.waitForSelector('.test-strip');
  const labels = await t.locator('.test-strip button span').allTextContents();
  check('test strip: seven bands, centred on the current exposure', labels.join(' ') === '−1.5 −1.0 −0.5 0 +0.5 +1.0 +1.5', labels.join(' '));
  await t.waitForTimeout(350);
  const shot = await t.locator('.stage__frame').screenshot({ type: 'png' });
  const meta = await sharp(shot).metadata();
  const brightness = [];
  for (let i = 0; i < 7; i++) {
    const band = await sharp(shot)
      .extract({ left: Math.round(((i + 0.3) / 7) * meta.width), top: Math.round(meta.height * 0.45), width: Math.round((0.4 / 7) * meta.width), height: Math.round(meta.height * 0.1) })
      .greyscale()
      .raw()
      .toBuffer();
    brightness.push(band.reduce((a, b) => a + b, 0) / band.length);
  }
  check('test strip: each band really is brighter than the last', brightness.every((v, i) => i === 0 || v > brightness[i - 1] + 2), brightness.map((v) => v.toFixed(0)).join(' '));
  await t.click('.tool-bar button:has-text("1 stop")');
  const wide = await t.locator('.test-strip button span').allTextContents();
  check('test strip: the step between bands can change', wide.join(' ') === '−3.0 −2.0 −1.0 0 +1.0 +2.0 +3.0', wide.join(' '));
  // An active button must stay readable while the mouse is over it.
  await t.hover('button[aria-label="Test strip"]');
  const activeButton = await t.evaluate(() => { const c = getComputedStyle(document.querySelector('button[aria-label="Test strip"]')); return { background: c.backgroundColor, color: c.color }; });
  check('buttons: an active button stays readable on hover', activeButton.background !== activeButton.color && activeButton.background.startsWith('rgb(239'), JSON.stringify(activeButton));
  await t.click('.tool-bar button:has-text("½ stop")');
  await t.click('.test-strip button:has-text("+0.5")');
  await t.waitForFunction(() => !document.querySelector('.test-strip'));
  const set = await t.locator('.slider:has(#control-exposure) .slider__value').textContent();
  check('test strip: clicking a band sets that exposure and closes', set.includes('+0.50'), set.trim());
  await t.click('button[aria-label="Undo"]');
  check('test strip: undo takes it back', (await t.locator('.slider:has(#control-exposure) .slider__value').textContent()).includes('0.00'));
  await t.click('.text-btn:has-text("Test strip")');
  await t.waitForSelector('.test-strip');
  await t.keyboard.press('Escape');
  await t.waitForFunction(() => !document.querySelector('.test-strip'));
  check('test strip: opens from the panel, Escape closes it', true);
  await toolCtx.close();
}

// ── Live film camera ──
{
  const camCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, permissions: ['camera'] });
  const c = await camCtx.newPage();
  track(c, 'camera');
  await c.addInitScript(() => {
    window.__streams = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.__calls = (window.__calls ?? 0) + 1;
      const stream = await original(constraints);
      window.__streams.push(stream);
      return stream;
    };
  });
  await c.goto(URL_);
  await c.waitForSelector('.app[data-room="safelight"]', { timeout: 30000 });
  await c.mouse.click(500, 400);
  await c.waitForFunction(() => document.querySelector('.sample-hint'), null, { timeout: 15000 });
  check('camera: never asks for the camera until you click it', (await c.evaluate(() => window.__calls ?? 0)) === 0);

  await c.click('.roll__add:has-text("Camera")');
  await c.waitForSelector('.shutter:not([disabled])', { timeout: 20000 });
  check('camera: opens and is ready to shoot', true);
  await c.waitForTimeout(600);
  const stageShot = () => c.locator('.stage__frame').screenshot({ type: 'jpeg', quality: 70 });
  const first = await stageShot();
  await c.waitForTimeout(450);
  const second = await stageShot();
  check('camera: the picture is live', Buffer.compare(first, second) !== 0, `${first.length} / ${second.length} bytes`);

  const saturation = async () => {
    await c.waitForTimeout(300);
    const { data, info } = await sharp(await stageShot()).raw().toBuffer({ resolveWithObject: true });
    let total = 0, n = 0;
    for (let i = 0; i < data.length; i += info.channels * 41) { total += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]); n++; }
    return total / n;
  };
  await c.click('.frame[data-stock="slide50"]');
  const colour = await saturation();
  await c.click('.frame[data-stock="fine100"]');
  await c.waitForFunction(() => document.querySelector('.filmbox__name').textContent.trim() === 'Fine');
  const mono = await saturation();
  check('camera: the viewfinder shows the chosen film, live', colour > 15 && mono < 6, `saturation ${colour.toFixed(1)} on slide, ${mono.toFixed(1)} on black and white`);

  const stripDiff = await c.evaluate(async () => {
    const read = () => { const k = document.querySelector('.frame.is-on canvas'); return k.getContext('2d').getImageData(0, 0, k.width, k.height).data; };
    const a = read();
    await new Promise((r) => setTimeout(r, 1500));
    const b = read();
    let d = 0;
    for (let i = 0; i < a.length; i += 80) d += Math.abs(a[i] - b[i]);
    return d;
  });
  check('camera: the film strip follows the live scene', stripDiff > 0, `difference ${stripDiff}`);

  const rollBefore = await c.locator('.roll__item').count();
  await c.click('.shutter');
  await c.waitForFunction((n) => document.querySelectorAll('.roll__item').length === n + 1, rollBefore);
  check('camera: a shot lands in the roll', (await c.locator('.roll__item img').first().getAttribute('src')).startsWith('blob:'));
  await c.keyboard.press('Space');
  await c.waitForFunction((n) => document.querySelectorAll('.roll__item').length === n + 2, rollBefore);
  check('camera: Space takes a photo', (await c.textContent('.camera-count')).includes('2 shots'), await c.textContent('.camera-count'));
  check('camera: the viewfinder mode locks once you have started', await c.isDisabled('.camera-bar .segmented button:has-text("No peeking")'));

  await c.click('.camera-bar button:has-text("Done")');
  await c.waitForFunction(() => !document.querySelector('.shutter'));
  check('camera: closing turns the camera off', await c.evaluate(() => window.__streams.length > 0 && window.__streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))));
  await c.waitForFunction(() => document.querySelector('.topbar__name')?.textContent.startsWith('Safelight '), null, { timeout: 10000 });
  await c.waitForFunction(() => /\d+ × \d+/.test(document.querySelector('.topbar__dims')?.textContent ?? ''));
  check('camera: closing opens your latest shot', (await c.textContent('.filmbox__name')).trim() === 'Fine');
  await c.click('button:has-text("Export")');
  await c.waitForSelector('.export');
  const [camDl] = await Promise.all([c.waitForEvent('download', { timeout: 60000 }), c.click('button:has-text("Save this photo")')]);
  const camPath = join(OUT, 'shot.jpg');
  await camDl.saveAs(camPath);
  const camMeta = await sharp(camPath).metadata();
  check('camera: a shot exports like any photo', camMeta.format === 'jpeg' && camMeta.width > 300 && !camMeta.exif, `${camMeta.width}×${camMeta.height}`);
  await c.keyboard.press('Escape');
  await c.waitForFunction(() => !document.querySelector('.export'));

  // No peeking.
  await c.keyboard.press('v');
  await c.waitForSelector('.shutter:not([disabled])', { timeout: 20000 });
  await c.click('.frame[data-stock="gold200"]');
  await c.waitForFunction(() => document.querySelector('.filmbox__name').textContent.trim() === 'Gold');
  await c.click('.camera-bar .segmented button:has-text("No peeking")');
  check('no peeking: starts with 36 shots', (await c.textContent('.camera-count')).includes('36 left'), await c.textContent('.camera-count'));
  check('no peeking: the viewfinder has framing marks', (await c.locator('.viewfinder').count()) === 1);
  for (let i = 0; i < 3; i++) await c.click('.shutter');
  await c.waitForFunction(() => document.querySelectorAll('.roll__latent').length === 3);
  check('no peeking: shots stay hidden, counted down', (await c.textContent('.camera-count')).includes('33 left'), await c.textContent('.camera-count'));
  check('no peeking: nothing to see in the roll', (await c.locator('.roll__latent img').count()) === 0);
  await c.click('.roll__latent >> nth=0');
  await c.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Still in the camera'));
  check('no peeking: clicking a hidden shot says why', true);
  check('no peeking: the film can’t change mid-roll', await c.isDisabled('.frame[data-stock="pan400"]'));
  for (let i = 3; i < 36; i++) await c.click('.shutter');
  await c.waitForFunction(() => document.querySelectorAll('.roll__latent').length === 36, null, { timeout: 30000 });
  check('no peeking: a roll ends at 36 frames', (await c.textContent('.camera-count')).includes('0 left') && (await c.isDisabled('.shutter')), await c.textContent('.camera-count'));
  await c.click('.camera-bar button:has-text("Develop roll (36)")');
  await c.waitForSelector('.app[data-room="safelight"]', { timeout: 15000 });
  check('no peeking: developing the roll plays the tray', true);
  await c.mouse.click(500, 400);
  await c.waitForSelector('.app[data-room="lit"]', { timeout: 10000 });
  check('no peeking: the whole roll is now revealed', (await c.locator('.roll__latent').count()) === 0 && (await c.locator('.roll__item img[src^="blob:"]').count()) >= 36);
  check('no peeking: they were shot on the loaded film', (await c.textContent('.filmbox__name')).trim() === 'Gold');
  check('no peeking: the camera is off again', await c.evaluate(() => window.__streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))));
  await camCtx.close();

  // When the camera isn't allowed.
  for (const [name, script, expected] of [
    ['blocked', () => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('no', 'NotAllowedError'); }; }, 'blocked'],
    ['missing', () => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('no', 'NotFoundError'); }; }, 'No camera'],
    ['in use', () => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('no', 'NotReadableError'); }; }, 'Another app'],
    ['unsupported', () => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); }, 'can’t use the camera'],
  ]) {
    const bad = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const b = await bad.newPage();
    track(b, `camera ${name}`);
    await b.addInitScript(script);
    await b.goto(URL_);
    await b.waitForSelector('.sample-hint', { timeout: 30000 });
    await b.click('.roll__add:has-text("Camera")');
    await b.waitForSelector('.stage__message--error');
    check(`camera ${name}: explains the problem`, (await b.textContent('.stage__message--error')).includes(expected), (await b.textContent('.stage__message--error')).slice(0, 70));
    await b.click('.camera-bar button:has-text("Close")');
    await b.waitForFunction(() => !document.querySelector('.shutter') && document.querySelector('.sample-hint'), null, { timeout: 10000 });
    await b.waitForTimeout(400);
    const px = await sharp(await b.locator('.stage__frame').screenshot({ type: 'png' })).stats();
    check(`camera ${name}: closing brings your photo back`, px.channels[0].mean > 5, `mean ${px.channels[0].mean.toFixed(1)}`);
    await bad.close();
  }
}

// ── The new tools on a phone ──
{
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, reducedMotion: 'reduce', permissions: ['camera'] });
  const m = await phoneCtx.newPage();
  track(m, 'phone tools');
  await m.goto(URL_);
  await m.waitForSelector('.sample-hint', { timeout: 30000 });
  const onScreen = async (selector) => {
    const b = await m.locator(selector).boundingBox();
    return !!b && b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= 390.5 && b.y + b.height <= 844.5;
  };
  check('phone: Export still fits beside the new buttons', await onScreen('button:has-text("Export")'));
  await m.tap('button[aria-label="Crop and rotate"]');
  await m.waitForSelector('.crop__box');
  check('phone: crop controls fit the screen', (await onScreen('.crop-bar')) && (await onScreen('.crop-bar button:has-text("Done")')));
  check('phone: no sideways scrolling in crop', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const stageH = (await m.locator('.stage__frame').boundingBox()).height;
  check('phone: the picture stays visible above the crop controls', stageH > 150, `${Math.round(stageH)}px tall`);
  await m.tap('.crop-bar button:has-text("Done")');
  await m.waitForFunction(() => !document.querySelector('.crop__box'));
  await m.tap('.tabs button:has-text("Adjust")');
  await m.tap('.text-btn:has-text("Test strip")');
  await m.waitForSelector('.test-strip');
  check('phone: five bands on a narrow screen', (await m.locator('.test-strip button').count()) === 5);
  await m.tap('.tool-bar button:has-text("Close")');
  await m.tap('.tabs button:has-text("Photos")');
  await m.tap('.roll__add:has-text("Camera")');
  await m.waitForSelector('.shutter:not([disabled])', { timeout: 20000 });
  check('phone: the shutter and camera controls fit', (await onScreen('.camera-bar')) && (await onScreen('.shutter')));
  await m.tap('.shutter');
  await m.waitForFunction(() => document.querySelector('.camera-count')?.textContent.includes('1 shot'));
  check('phone: tapping the shutter takes a shot', true);
  await m.screenshot({ path: join(OUT, 'phone-camera.png') });
  await phoneCtx.close();
}

check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
check('no failed requests', failed.length === 0, failed.slice(0, 3).join(' | '));
check('nothing is ever sent to another server', external.length === 0, external.slice(0, 3).join(' | '));

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
