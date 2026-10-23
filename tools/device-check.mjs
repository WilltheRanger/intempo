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
 * Chromium can invent the microphone. `--use-fake-device-for-media-stream`
 * answers `getUserMedia` with a synthetic stream, and
 * `--use-file-for-fake-audio-capture` feeds it a click track, so what the app
 * receives is music rather than a tone. Everything above that is the app's own
 * code: the permission prompt, the worklet, the level meter, the encode.
 *
 * **The camera is the phone's own since 2026-10-23**, not a `getUserMedia`
 * viewfinder: a page is photographed through an `<input capture>`, which a
 * phone answers with its camera app. Playwright's file chooser is that input,
 * so the camera checks hand it a photographed page from `fixtures/scores` —
 * the same file a phone's camera would hand over — and hold the app to keeping
 * all of it.
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
import { TAKE_HEARING } from './screen-copy.mjs';
import { existsSync, readFileSync } from 'node:fs';
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

/** The pixel size of a JPEG, read from its frame header. */
function jpegSize(path) {
  const bytes = readFileSync(path);
  let at = 2;
  while (at < bytes.length) {
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    // SOF0 to SOF15, less the four markers in that range that are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

// A whole portrait page, as a phone's camera hands one over — the shape the
// viewfinder used to crop. The `fixtures/scores` pages are single lines of music
// and would pass a crop that only trimmed the sides.
const PAGE = `${ROOT}mobile/assets/captures/page-01.jpg`;

/**
 * The camera opens from the tap, and the whole photograph is the page.
 *
 * Four claims, each one the camera flow exists for. The button opens the
 * camera *itself* — a file input asking for the back camera, inside the click,
 * which is the only moment a browser allows it. The photograph lands on the
 * review list without another screen in between. And it lands **whole**: the
 * viewfinder this replaced cropped every photograph to a page-shaped window,
 * so the page kept is compared with the file the camera gave, pixel for pixel
 * in size.
 */
async function checkCamera(browser) {
  console.log('\ncamera');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

  await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const chooser = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await page.getByText('Open camera').first().click({ timeout: 8000 }).catch(() => {});
  const camera = await chooser;
  if (!camera) {
    fail('Open camera opens the camera', 'no file input was opened by the click');
    await context.close();
    return;
  }
  const capture = await camera.element().getAttribute('capture');
  const accept = await camera.element().getAttribute('accept');
  if (capture === 'environment' && /image/.test(accept ?? '')) {
    pass('Open camera opens the back camera, from the tap', `capture=${capture}`);
  } else {
    fail('Open camera opens the back camera, from the tap', `capture=${capture} accept=${accept}`);
  }

  await camera.setFiles(PAGE);
  try {
    await page.waitForURL(/\/scan\/pages$/, { timeout: 10000 });
    pass('the photograph goes straight to the review list');
  } catch {
    fail('the photograph goes straight to the review list', `landed on ${new URL(page.url()).pathname}`);
  }

  const counted = await page.getByText('Continue with 1 page').count();
  if (counted > 0) pass('it is page 1 of the scan');
  else fail('it is page 1 of the scan', (await page.evaluate(() => document.body.innerText)).slice(0, 120));

  const expected = jpegSize(PAGE);
  await page.waitForTimeout(1500);
  const shown = await page.$$eval('img', (images) =>
    images.map((image) => ({ width: image.naturalWidth, height: image.naturalHeight })),
  );
  if (expected && shown.some((s) => s.width === expected.width && s.height === expected.height)) {
    pass('the whole photograph is kept, at the camera\'s own size', `${expected.width}x${expected.height}`);
  } else {
    fail(
      'the whole photograph is kept, at the camera\'s own size',
      `file ${JSON.stringify(expected)}, shown ${JSON.stringify(shown)}`,
    );
  }

  if (errors.length) fail('no page errors while photographing', errors[0]);
  else pass('no page errors while photographing');

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

/**
 * A camera closed without a photograph changes nothing.
 *
 * The viewfinder reset the scan as it opened, so opening the camera and
 * backing out threw away pages nobody had finished with. Now nothing happens
 * until a photograph arrives: the scan screen is still the scan screen, and no
 * page has been added.
 */
async function checkCameraCancelled(browser) {
  console.log('\ncamera, closed without a photograph');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const chooser = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await page.getByText('Open camera').first().click({ timeout: 8000 }).catch(() => {});
  const camera = await chooser;
  if (!camera) {
    fail('a closed camera leaves the scan as it was', 'no file input was opened');
    await context.close();
    return;
  }
  await camera.setFiles([]);
  await page.waitForTimeout(1500);
  const path = new URL(page.url()).pathname;
  const stillOffered = await page.getByText('Open camera').count();
  if (path === '/scan' && stillOffered > 0 && errors.length === 0) {
    pass('a closed camera leaves the scan as it was');
  } else {
    fail('a closed camera leaves the scan as it was', `on ${path}; ${errors[0] ?? 'no camera offered'}`);
  }

  // And a camera that gave nothing back says so, with a way round it.
  await page.goto(`${BASE}/scan?problem=failed`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const screen = await page.evaluate(() => document.body.innerText || '');
  if (/Try again/.test(screen) && /Choose photos/.test(screen)) {
    pass('a failed photograph offers the camera again and photos instead');
  } else {
    fail('a failed photograph offers the camera again and photos instead', screen.slice(0, 160).replace(/\n/g, ' / '));
  }
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
    // The option's whole label since its line underneath went (2026-09-30):
    // it was "Visual. A silent pulse on screen." and matched on the prefix.
    const visual = page.locator('[aria-label="Visual"]').first();
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
  console.log(`device-check: driving ${BASE}`);

  const granted = await chromium.launch({
    executablePath: EXECUTABLE,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${ROOT}fixtures/audio/app_encoder_click_track_48k.wav`,
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
  await checkCameraCancelled(refused);
  await refused.close();

  console.log(
    failures.length
      ? `\ndevice-check: ${failures.length} failed\n  ${failures.join('\n  ')}`
      : '\ndevice-check: microphone, camera and audio out all answered',
  );
  process.exit(failures.length ? 1 : 0);
}

await main();
