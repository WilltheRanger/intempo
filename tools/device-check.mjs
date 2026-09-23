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
import { TAKE_HEARING } from './screen-copy.mjs';
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

/**
 * Get past the pre-flight checks, on the runs where they appear.
 *
 * They used to stand in front of the recorder on every fresh profile; they
 * open only for a real warning now, so this is usually a no-op — and stays
 * here because "usually" is not "never", and a device whose last take came
 * back silent gets them.
 */
async function clearFirstTakeGate(page) {
  const gate = page.locator('text=Set tempo & record').first();
  if (await gate.count()) {
    await gate.click();
    await page.waitForTimeout(1200);
  }
}

/**
 * Check the setup rows are on screen, above the record button.
 *
 * **They were behind a drag until 2026-09-23**, in a sheet that started
 * lowered, and this drove the drag with CDP touch events. The redesign
 * (`redesign/RecordReady.dc.html`) puts them in a fixed panel between the
 * score and the record button, so there is nothing to open. What is still
 * worth asserting is the thing the drag used to hide: that the row is inside
 * the viewport and not under the button, because a row the check can click
 * and a thumb cannot reach would be the same accident as before — this check
 * once passed on a page scroll no phone had.
 */
async function controlsOnScreen(page) {
  const row = await page
    .locator('[aria-label^="Metronome "]')
    .first()
    .boundingBox()
    .catch(() => null);
  const button = await page
    .locator('[aria-label="Start recording"]')
    .first()
    .boundingBox()
    .catch(() => null);
  const viewport = page.viewportSize();
  if (!row || !button || !viewport) return false;
  return row.y >= 0 && row.y + row.height <= button.y && button.y + button.height <= viewport.height;
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
  // screen says this only once the level meter has seen a sample above the
  // floor, so it is the app's own reading of its own microphone.
  //
  // **Through `screen-copy.mjs`, because this sentence was pinned twice.**
  // It read `/audio received/i` here and in `walk-app.mjs`, so improving the
  // copy — `Microphone: audio received` was a developer reading a stream,
  // shown to a musician mid-take — failed both tools at once, one of them
  // reporting a worklet that had not delivered. That is the third time in two
  // days a check here has named an app defect that was a deliberate copy
  // change, and the second in this file.
  await page.waitForTimeout(2500);
  const screen = await page.evaluate(() => document.body.innerText || '');
  if (screen.includes(TAKE_HEARING)) {
    pass('audio actually arrives from the device');
  } else {
    // The take bar's own line, whatever it now says, rather than a pattern
    // that only matches the sentence this check was written against.
    const heard = screen.split('\n').find((l) => /hearing|no sound|microphone/i.test(l))
      ?? '(no take line on screen)';
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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: [],
  });
  const page = await context.newPage();
  // **The denial is staged, not hoped for.** Withholding the permission and
  // letting the browser reject looked equivalent and is not: on a headless
  // runner with no audio subsystem the rejection is a *device* error, so the
  // app correctly said "The microphone could not be started" and this check —
  // which demanded the permission wording — failed on CI while passing on a
  // laptop. That is the check being wrong about the app, which is the worst
  // way for one to fail.
  //
  // `NotAllowedError` is what a browser throws for Block, so throwing it here
  // asks the question the check means to ask: given a refusal, does the screen
  // name the remedy. The device error has its own copy and its own path
  // through `microphoneFailure.ts`; this is not it.
  //
  // **A real `DOMException`, not an `Error` wearing its name.**
  // `microphoneFailure` opens with `error instanceof DOMException ? error.name
  // : ''`, deliberately — a duck-typed name is not a browser's answer. The
  // first attempt at this stub threw `Object.assign(new Error(...), { name })`
  // and fell straight through to "could not be started", which is the app
  // being right and the check being counterfeit.
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    media.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
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

  /*
    **Counted in the strip, not in a sentence.** This read `body.innerText` for
    the words "1 page" until 2026-09-16, and then failed for a day on a shutter
    that works: the counter it was reading was replaced by the filmstrip, and
    what the screen says after a shot is now the verdict on that shot — "The
    notes are clear". The check was pinned to copy, the copy was deliberately
    changed, and the report said the camera was broken.

    So it asserts the outcome instead. `Page 1 of 1` is the filmstrip's own
    accessible name — what a screen reader says about the page that was just
    taken — which is the thing "captured and counted" was always trying to
    mean, and it does not move when the words beside it do. The panel is
    checked separately, because "the shutter worked" and "the app said
    something about the shot" are two claims and one of them failing should not
    be reported as the other.
  */
  try {
    await page.click('[aria-label="Capture page"]', { timeout: 8000 });
    await page.waitForTimeout(2500);
    const counted = await page.locator('[aria-label^="Page 1 of 1"]').count();
    if (counted > 0) pass('a page is captured and counted');
    else {
      const screen = await page.evaluate(() => document.body.innerText || '');
      fail('a page is captured and counted', screen.slice(0, 120).replace(/\n/g, ' / '));
    }

    const verdict = await page.evaluate(() => document.body.innerText || '');
    if (/keep it/i.test(verdict) && /take it again/i.test(verdict)) {
      pass('the shot is judged before it is kept');
    } else {
      fail('the shot is judged before it is kept', verdict.slice(0, 120).replace(/\n/g, ' / '));
    }
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

/**
 * A document WebKit will not capture from, and the way out of it.
 *
 * **Reported from a real iPhone on 2026-09-12**, on the deployed build, in a
 * home-screen web app. `getUserMedia` rejected with `InvalidStateError` — the
 * document was not fully active — and the screen said so correctly and then
 * advised "Pull down to refresh, then try again" on a screen that renders
 * `<ScreenContainer scrollable={false}>`, inside a context with no address bar.
 * Every route the advice named was absent.
 *
 * So the assertion is not that a sentence appears. It is that the control
 * exists and **actually reloads the page** — checked by planting a value on
 * `window` and requiring it to be gone afterwards, because a button that looks
 * right and does nothing is the failure this is about, one layer up.
 */
async function checkStaleDocument(browser) {
  console.log('\nmicrophone, stale document');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    media.getUserMedia = () =>
      Promise.reject(new DOMException('not fully active', 'InvalidStateError'));
  });
  await page.goto(`${BASE}/pieces/${PIECE}/record`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await clearFirstTakeGate(page);
  await page.click('[aria-label="Start recording"]').catch(() => {});
  await page.waitForTimeout(2500);

  const screen = await page.evaluate(() => document.body.innerText || '');
  if (/reload/i.test(screen) && !/pull down|address bar/i.test(screen)) {
    pass('says the page needs reloading, and names no gesture it lacks');
  } else {
    fail(
      'says the page needs reloading, and names no gesture it lacks',
      screen.slice(0, 160).replace(/\n/g, ' / '),
    );
  }

  // Survives a re-render; does not survive a navigation. That asymmetry is the
  // whole assertion.
  await page.evaluate(() => {
    window.__beforeReload = 'still here';
  });

  const button = page.locator('text=Reload and try again').first();
  if (!(await button.count())) {
    fail('offers a control that performs the reload', 'no reload control on screen');
    await context.close();
    return;
  }

  await button.click();
  await page.waitForTimeout(2500);
  const survived = await page.evaluate(() => window.__beforeReload ?? null);
  if (survived === null) {
    pass('offers a control that performs the reload');
  } else {
    fail(
      'offers a control that performs the reload',
      'the button is drawn but the document never reloaded',
    );
  }

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

  // Asserted rather than assumed: a row off the screen or under the button
  // would leave every check below testing a control nobody can reach.
  if (!(await controlsOnScreen(page))) {
    fail('the setup rows sit on screen above the record button', 'a row is off screen or under the button');
    await context.close();
    return;
  }
  pass('the setup rows sit on screen above the record button');

  const listen = page.locator('[aria-label^="Listen from bar"]').first();
  if (await listen.count()) {
    await listen.click();
    await page.waitForTimeout(3000);
    const started = await page.evaluate(() => window.__started);
    if (started > 0) pass('the reference pitch plays', `${started} source(s)`);
    else fail('the reference pitch plays', 'nothing was scheduled on the audio clock');
  } else {
    fail('the reference pitch plays', 'no Listen control on the screen');
  }

  // **Silence here is the correct answer**, and it is worth more on a real
  // device than it used to be. The record screen's metronome control was a
  // two-state toggle; it is a picker now, so the one mode that ends up inside
  // the recording it is supposed to be timing is offered here rather than only
  // on Profile. Choosing the silent one has to actually stay silent on the
  // hardware, which is the half no Chromium gate can answer for.
  await page.evaluate(() => { window.__started = 0; });
  const metronome = page.locator('[aria-label^="Metronome "]').first();
  if (await metronome.count()) {
    await metronome.click();
    await page.waitForTimeout(600);
    const visual = page.locator('[aria-label^="Visual."]').first();
    if (await visual.count()) {
      await visual.click();
      await page.waitForTimeout(2500);
      const chosen = await metronome.getAttribute('aria-label');
      const started = await page.evaluate(() => window.__started);
      if (/Visual/i.test(chosen ?? '') && started === 0) {
        pass('the visual metronome can be chosen here, and stays silent');
      } else {
        fail('the visual metronome can be chosen here, and stays silent',
          `the row reads "${chosen}" and ${started} source(s) played`);
      }
    } else {
      fail('the visual metronome can be chosen here, and stays silent',
        'the picker opened without a Visual option');
    }
  } else {
    fail('the visual metronome can be chosen here, and stays silent',
      'no Metronome control');
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
  await checkStaleDocument(refused);
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
