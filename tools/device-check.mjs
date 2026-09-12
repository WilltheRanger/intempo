/**
 * Drive the microphone and the camera, with devices the browser invents.
 *
 * **Nothing else in this repository touches either one.** The unit suites
 * exercise the modules around them — `lib/audio/permission.ts`,
 * `microphoneFailure.ts`, `lib/scan/*` — the a11y sweep renders routes, and
 * `walk-app.mjs` drives taps. All of them stop at the edge where the app asks
 * the operating system for hardware, which is the edge a musician meets first
 * and the one that has never been run outside a developer's hands.
 *
 * Chromium can invent both. `--use-fake-device-for-media-stream` answers
 * `getUserMedia` with a synthetic stream, and the two `--use-file-for-*`
 * flags feed it real content — a click track into the microphone, a
 * photographed page into the camera — so what the app receives is audio and
 * music rather than a tone and a test pattern. Everything above that is the
 * app's own code: the permission prompt, the worklet, the level meter, the
 * capture, the encode.
 *
 * What it cannot reach: upload, transcription and analysis, which need
 * `SUPABASE_SERVICE_ROLE_KEY` and a reader. `/v1/ready` is the check for
 * those, and it names them itself.
 *
 * Run against a served fixtures build, like the other two drivers:
 *
 *     cd mobile && npm run build:web        # with .env moved aside
 *     npx serve dist -l 4320 -s &
 *     node ../tools/device-check.mjs 4320
 *
 * Exits non-zero on any failure, so it can gate a change.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Resolved from `mobile/`, where playwright is installed with `--no-save` — a
// bare import would resolve against this directory instead. Same note as
// `audit-a11y.mjs` and `walk-app.mjs`, which the documented command failed on.
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = `http://localhost:${process.argv[2] ?? '4320'}`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PIECE = 'fixture-bach-bwv1001';

const failures = [];
const fail = (what, detail) => {
  failures.push(what);
  console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ''}`);
};
const pass = (what, detail) => console.log(`  ok    ${what}${detail ? `  (${detail})` : ''}`);

/**
 * The Chromium to drive.
 *
 * This environment pre-installs one at a fixed path and sets
 * `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, so Playwright's own resolution finds
 * nothing; anywhere else it has downloaded its own and knows where it is.
 */
const EXECUTABLE = existsSync('/opt/pw-browsers/chromium')
  ? '/opt/pw-browsers/chromium'
  : undefined;

/**
 * A page of real notation, as a video the fake camera can play.
 *
 * Y4M is uncompressed frames behind a one-line header, which is why it can be
 * written here with no encoder: this container has no ffmpeg. The fixture is
 * letterboxed onto white rather than stretched — the scanner's own guidance is
 * "fill the frame, keep the page flat", and a page distorted to 4:3 is not the
 * thing it asks for.
 */
function sheetMusicVideo() {
  const W = 640;
  const H = 480;
  const dir = mkdtempSync(join(tmpdir(), 'intempo-cam-'));
  const path = join(dir, 'sheet.y4m');

  // **Pillow, not an npm image library.** The backend virtualenv this
  // repository already depends on carries it, and the alternative was a
  // `sharp` that is not in `mobile/`'s tree — an install to make a test
  // fixture. There is no ffmpeg in this container either, which is fine:
  // Y4M is uncompressed planes behind a one-line header, so the encoder is
  // the header.
  const script = `
import sys
from PIL import Image
W, H, src, dst = ${W}, ${H}, sys.argv[1], sys.argv[2]
page = Image.new('RGB', (W, H), (255, 255, 255))
im = Image.open(src).convert('RGB')
im.thumbnail((W, H), Image.LANCZOS)
page.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
y, cb, cr = page.convert('YCbCr').split()
frame = (y.tobytes() + cb.resize((W//2, H//2), Image.BOX).tobytes()
         + cr.resize((W//2, H//2), Image.BOX).tobytes())
with open(dst, 'wb') as f:
    f.write(f'YUV4MPEG2 W{W} H{H} F25:1 Ip A1:1 C420\\n'.encode())
    for _ in range(50):
        f.write(b'FRAME\\n'); f.write(frame)
`;
  for (const python of [`${ROOT}backend/.venv/bin/python`, 'python3']) {
    const run = spawnSync(python, ['-c', script, `${ROOT}fixtures/scores/01_simple_printed.jpg`, path], {
      encoding: 'utf8',
    });
    if (run.status === 0 && existsSync(path)) {
      return { path, real: true };
    }
  }

  // A flat field still proves the stream, the capture and the encode; only the
  // picture is less interesting. Better than skipping the camera entirely.
  const frame = Buffer.concat([
    Buffer.alloc(W * H, 200),
    Buffer.alloc((W / 2) * (H / 2), 128),
    Buffer.alloc((W / 2) * (H / 2), 128),
  ]);
  const frames = [Buffer.from(`YUV4MPEG2 W${W} H${H} F25:1 Ip A1:1 C420\n`)];
  for (let i = 0; i < 50; i += 1) frames.push(Buffer.from('FRAME\n'), frame);
  writeFileSync(path, Buffer.concat(frames));
  return { path, real: false };
}

/** Get past the one-time setup card that stands in front of the recorder. */
async function clearFirstTakeGate(page) {
  const gate = page.locator('text=Set tempo & record').first();
  if (await gate.count()) {
    await gate.click();
    await page.waitForTimeout(1200);
  }
}

async function checkMicrophone(browser) {
  console.log('\nmicrophone');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

  await page.goto(`${BASE}/pieces/${PIECE}/record`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await clearFirstTakeGate(page);

  try {
    await page.click('[aria-label="Start recording"]', { timeout: 10000 });
    pass('the recorder starts');
  } catch {
    fail('the recorder starts', 'no "Start recording" control responded');
    await context.close();
    return;
  }

  try {
    await page.waitForSelector('[aria-label="Stop recording"]', { timeout: 20000 });
    pass('the count-in ends and recording begins');
  } catch {
    fail('the count-in ends and recording begins', 'never reached the recording state');
    await context.close();
    return;
  }

  // **The one assertion that proves hardware, rather than a button.** The
  // screen says "audio received" only once the level meter has seen a sample
  // above the floor, so this is the app's own reading of its own microphone.
  await page.waitForTimeout(2500);
  const screen = await page.evaluate(() => document.body.innerText || '');
  if (/audio received/i.test(screen)) {
    pass('audio actually arrives from the device');
  } else {
    const heard = screen.match(/Microphone:.*/)?.[0] ?? '(no microphone line on screen)';
    fail('audio actually arrives from the device', heard);
  }

  try {
    await page.click('[aria-label="Stop recording"]', { timeout: 8000 });
    await page.waitForTimeout(4000);
    pass('the take stops and the screen moves on');
  } catch {
    fail('the take stops and the screen moves on');
  }

  if (errors.length) fail('no page errors while recording', errors[0]);
  else pass('no page errors while recording');

  await context.close();
}

async function checkMicrophoneRefused(browser) {
  console.log('\nmicrophone, refused');
  // No permission, and no `--use-fake-ui-for-media-stream` on this browser, so
  // `getUserMedia` rejects exactly as it does for somebody who pressed Block.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: [],
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/pieces/${PIECE}/record`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await clearFirstTakeGate(page);
  await page.click('[aria-label="Start recording"]').catch(() => {});
  await page.waitForTimeout(3000);

  const screen = await page.evaluate(() => document.body.innerText || '');
  // Naming the remedy is the requirement, not merely reporting the failure: a
  // blocked microphone is fixed in browser chrome the app cannot reach, so a
  // message that does not say where to go leaves somebody stuck on a dead
  // button.
  if (/blocking the microphone/i.test(screen) && /allow/i.test(screen)) {
    pass('says what is wrong and where to fix it');
  } else {
    fail('says what is wrong and where to fix it', screen.slice(0, 160).replace(/\n/g, ' / '));
  }
  await context.close();
}

async function checkCamera(browser) {
  console.log('\ncamera');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['camera'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

  await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const video = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { w: v.videoWidth, h: v.videoHeight, paused: v.paused, ready: v.readyState } : null;
  });
  if (video && video.w > 0 && !video.paused && video.ready >= 2) {
    pass('a live viewfinder is running', `${video.w}x${video.h}`);
  } else {
    fail('a live viewfinder is running', JSON.stringify(video));
  }

  try {
    await page.click('[aria-label="Capture page"]', { timeout: 8000 });
    await page.waitForTimeout(2500);
    const screen = await page.evaluate(() => document.body.innerText || '');
    if (/1 page/.test(screen)) pass('a page is captured and counted');
    else fail('a page is captured and counted', screen.slice(0, 120).replace(/\n/g, ' / '));
  } catch {
    fail('a page is captured and counted', 'no "Capture page" control responded');
  }

  try {
    await page.click('[aria-label="Done capturing"]', { timeout: 8000 });
    await page.waitForTimeout(2500);
    const path = new URL(page.url()).pathname;
    if (path.endsWith('/scan/pages')) pass('review opens on the captured page');
    else fail('review opens on the captured page', `landed on ${path}`);
  } catch {
    fail('review opens on the captured page');
  }

  if (errors.length) fail('no page errors while scanning', errors[0]);
  else pass('no page errors while scanning');

  await context.close();
}

async function checkCameraRefused(browser) {
  console.log('\ncamera, refused');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: [],
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const screen = await page.evaluate(() => document.body.innerText || '');
  if (/needs your camera/i.test(screen)) pass('says the camera is needed and why');
  else fail('says the camera is needed and why', screen.slice(0, 160).replace(/\n/g, ' / '));
  await context.close();
}

async function checkAudioOut(browser) {
  console.log('\naudio out');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  // Count what is actually scheduled on the audio clock. A button that toggles
  // and plays nothing looks identical in a screenshot.
  await page.addInitScript(() => {
    window.__started = 0;
    const wrap = (Ctor) =>
      class extends Ctor {
        createOscillator() {
          const node = super.createOscillator();
          const start = node.start.bind(node);
          node.start = (...a) => { window.__started += 1; return start(...a); };
          return node;
        }
        createBufferSource() {
          const node = super.createBufferSource();
          const start = node.start.bind(node);
          node.start = (...a) => { window.__started += 1; return start(...a); };
          return node;
        }
      };
    window.AudioContext = wrap(window.AudioContext);
    if (window.webkitAudioContext) window.webkitAudioContext = wrap(window.webkitAudioContext);
  });

  await page.goto(`${BASE}/pieces/${PIECE}/record`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await clearFirstTakeGate(page);

  const listen = page.locator('text=Listen').first();
  if (await listen.count()) {
    await listen.click();
    await page.waitForTimeout(3000);
    const started = await page.evaluate(() => window.__started);
    if (started > 0) pass('the reference pitch plays', `${started} source(s)`);
    else fail('the reference pitch plays', 'nothing was scheduled on the audio clock');
  } else {
    fail('the reference pitch plays', 'no Listen control on the screen');
  }

  // **Silence here is the correct answer.** The default on-mode is visual,
  // deliberately: a click through the speaker is the one mode that ends up
  // inside the recording it is supposed to be timing. The audible mode is
  // chosen on Profile, behind a headphones warning, and is checked there.
  await page.evaluate(() => { window.__started = 0; });
  const metronome = page.locator('[aria-label="Metronome"]');
  if (await metronome.count()) {
    await metronome.click();
    await page.waitForTimeout(2500);
    const screen = await page.evaluate(() => document.body.innerText || '');
    const started = await page.evaluate(() => window.__started);
    if (/visual metronome/i.test(screen) && started === 0) {
      pass('the metronome defaults to visual, and stays silent');
    } else {
      fail('the metronome defaults to visual, and stays silent',
        `mode line missing or ${started} source(s) played`);
    }
  } else {
    fail('the metronome defaults to visual, and stays silent', 'no Metronome control');
  }

  await context.close();
}

async function main() {
  const video = sheetMusicVideo();
  console.log(`device-check: driving ${BASE}`);
  console.log(`  camera is fed ${video.real ? 'a photographed page' : 'a flat field (no image encoder here)'}`);

  const granted = await chromium.launch({
    executablePath: EXECUTABLE,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${ROOT}fixtures/audio/app_encoder_click_track_48k.wav`,
      `--use-file-for-fake-video-capture=${video.path}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  await checkMicrophone(granted);
  await checkCamera(granted);
  await checkAudioOut(granted);
  await granted.close();

  // A second browser, without the auto-accept flag, so a refusal is a real one.
  const refused = await chromium.launch({
    executablePath: EXECUTABLE,
    args: ['--use-fake-device-for-media-stream'],
  });
  await checkMicrophoneRefused(refused);
  await checkCameraRefused(refused);
  await refused.close();

  console.log(
    failures.length
      ? `\ndevice-check: ${failures.length} failed\n  ${failures.join('\n  ')}`
      : '\ndevice-check: microphone, camera and audio out all answered',
  );
  process.exit(failures.length ? 1 : 0);
}

await main();
