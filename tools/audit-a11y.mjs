/**
 * Measure the shipping app against three accessibility floors.
 *
 * An `audit-a11y.mjs` was run once against the legacy `frontend/` tree on
 * 2026-08-20 and did not survive the rebuild into `mobile/`. This is that check
 * pointed at the app that actually ships, so it is one command again rather
 * than an argument.
 *
 * Four checks, chosen for this product rather than off a generic list:
 *
 *  - **Accessible names.** A control without one is unusable with VoiceOver.
 *  - **44pt targets.** The iOS floor, and more pointed here than in most apps:
 *    the person tapping has an instrument under their chin and a bow in the
 *    other hand.
 *  - **4.5:1 contrast.** Also more pointed than usual, since sheet music gets
 *    read under whatever light the room has.
 *  - **Large text.** Dynamic Type is the accessibility setting people actually
 *    turn on, and a musician reading a phone on a stand is exactly who turns
 *    it on. `PageHeader` records a title that ran 218pt off a 390pt screen at
 *    2x — found by hand, fixed by hand, and nothing has watched for it since.
 *    See `TEXT_SCALE` below for what this can and cannot see.
 *
 * Run against a served fixtures build. Playwright is not a dependency of this
 * repository — install it into `mobile` with `--no-save`, so it is available
 * to run without joining the list of packages that ship to a phone:
 *
 *     cd mobile && npm run build:web        # with .env moved aside
 *     npx serve dist -l 4320 -s &
 *     npm i -D playwright --no-save
 *     node ../tools/audit-a11y.mjs 4320
 *
 * Exits non-zero when anything fails, so it can gate a change.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Resolved from `mobile/`, not from here.
 *
 * A bare `import { chromium } from 'playwright'` resolves against **this
 * file's** directory, not the working directory — so with playwright installed
 * where the instructions above put it, the command in those same instructions
 * failed with ERR_MODULE_NOT_FOUND. The tool has one documented way to run and
 * it did not work; anchoring the lookup to `mobile/package.json` makes the
 * lookup match the install, from any working directory.
 */
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const { chromium } = require('playwright');

const PORT = process.argv[2] ?? '4320';
const BASE = `http://localhost:${PORT}`;

/** The floor, in CSS pixels. `MIN_TOUCH_TARGET` in the design tokens. */
const MIN_TARGET = 44;
const MIN_CONTRAST = 4.5;
/** WCAG's large-text threshold: 24px, or 18.66px when bold. */
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;
const LARGE_CONTRAST = 3;

const ROUTES = [
  ['Today', ''],
  ['Library', 'library'],
  ['Insights', 'insights'],
  ['Profile', 'profile'],
  ['Piece detail', 'pieces/fixture-bach-bwv1001'],
  // **The same two routes, in the two states every scan passes through.** A
  // route list cannot see a state: `pieces/:pieceId` was already visited and
  // `unvisitedRoutes` was satisfied, while the screen a musician lands on the
  // moment a scan finishes had never been rendered by any sweep. Both of these
  // draw controls the `done` piece has none of — a progress bar with a stage
  // under it, and three recovery actions — so they are new touch targets and
  // new contrast, not a second look at the same pixels.
  ['Piece being read', 'pieces/fixture-reading-in-progress'],
  ['Score, still being read', 'pieces/fixture-reading-in-progress/score'],
  ['Page queued behind another', 'pieces/fixture-reading-queued/score'],
  ['Piece that could not be read', 'pieces/fixture-reading-failed'],
  ['Score that could not be read', 'pieces/fixture-reading-failed/score'],
  ['Score', 'pieces/fixture-clef-change-study/score'],
  ['Bar editor', 'pieces/fixture-clef-change-study/bars/3'],
  // The photographs, paged. `fixture-wohlfahrt-01` is the one multi-page part
  // in the library, so this is where the page caption and the pager exist at
  // all — the other pieces render a single image and no control.
  ['Original pages', 'pieces/fixture-wohlfahrt-01/score?view=original'],
  // **The tips, which is what this route renders on a fresh page.** Every
  // piece in the fixtures shows `PracticeSetup` first, so this entry — which
  // has said "Record" since the first sweep — has never once audited the
  // screen with the recording controls on it.
  ['Record — first-take tips', 'pieces/fixture-bach-bwv1001/record', {
    expect: 'Before your first take',
  }],
  // The screen behind it: target tempo with its steppers, the metronome
  // control, Listen, the start-at picker, the timer and Start recording. Eight
  // controls, none of them ever measured, on the screen where a take is made.
  //
  // Reached by seeding the preference the tips screen writes when it is
  // dismissed, rather than by a query parameter the app does not have — see
  // `seedPreferences`.
  [
    'Record — tempo and controls',
    'pieces/fixture-bach-bwv1001/record',
    { seed: { practiceSetupSeen: true }, expect: 'Target tempo' },
  ],
  // The payoff of the whole app, and the route the first sweep missed.
  ['Verdict', 'analyses/fixture-take-1', { expect: 'rushed' }],
  // **Its other three states, none of which had ever been on a screen.**
  // `VerdictScreen` branches twice on `failure` — recoverable and not are
  // different sentences and different buttons — and again on a status that is
  // not `ok`, before it draws a verdict at all. One route, four screens; the
  // path comparison in `unvisitedRoutes` sees one of them.
  [
    'Verdict — failed, recoverable',
    'analyses/fixture-take-failed',
    { expect: 'Try again' },
  ],
  [
    'Verdict — failed for good',
    'analyses/fixture-take-unrecoverable',
    { expect: "We couldn't process this recording" },
  ],
  [
    'Verdict — nothing heard',
    'analyses/fixture-take-silent',
    { expect: 'Nothing to measure' },
  ],
  [
    'Verdict — could not be matched to the score',
    'analyses/fixture-take-unmatched',
    { expect: 'matching your recording to the score' },
  ],
  ['Warmup', 'warmup'],
  ['Help', 'help'],
  ['Legal', 'legal/privacy'],
  ['Delete account', 'account/delete'],
  // Reachable, and both carry the reveal-password control that the two
  // *unreachable* auth screens also use — so this is where a regression in it
  // would be caught without a throwaway build.
  ['Change password', 'account/password'],
  ['Change email', 'account/email'],

  // **The scan flow, which no sweep had ever visited.** It is the app's main
  // way of getting music in, and the four screens between a photograph and a
  // saved piece were the largest unaudited area left.
  //
  // Reached by route, these render their **empty** states — the capture session
  // starts empty and the scanner needs a camera this container does not have.
  // That is real coverage of real screens (`/scan/pages` with nothing in it is
  // reachable by backing out of a scan), and it is **not** coverage of the
  // populated flow. `walk-app.mjs` covers that one, by importing two of the
  // repository's own fixture pages through the file picker.
  ['Add piece', 'add/import'],
  ['Scanner', 'scan'],
  ['Captured pages', 'scan/pages'],
  ['Transcribe', 'scan/sending'],
  ['Name the piece', 'scan/name'],

  ['Export data', 'account/export'],
  ['Acknowledgements', 'acknowledgements'],
];

const audit = () => {
  const parse = (value) => {
    const m = String(value).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m
      ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
      : null;
  };
  const lum = ({ r, g, b }) => {
    const c = [r, g, b]
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** The first painted background behind an element. */
  const backdrop = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        return bg.a === 1 ? bg : null;
      }
      node = node.parentElement;
    }
    const body = parse(getComputedStyle(document.body).backgroundColor);
    return body && body.a === 1 ? body : { r: 255, g: 255, b: 255, a: 1 };
  };
  /**
   * Hidden from assistive technology, or from touch, by any ancestor.
   *
   * **Both, and the first one cost a false report.** `ToggleRow` gives the
   * whole row the switch semantics and wraps the picture of the switch in
   * `aria-hidden` + `pointerEvents="none"`, so a screen reader hears one
   * control rather than two. Reading the DOM without honouring that reported
   * three unnamed 40x20 checkboxes on Profile that no user can reach or hear.
   */
  const hidden = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return true;
      if (getComputedStyle(node).pointerEvents === 'none') return true;
      node = node.parentElement;
    }
    return false;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      Number(s.opacity) > 0.05 &&
      !hidden(el)
    );
  };
  const describe = (el) => {
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim();
    return (label || '(no name)').slice(0, 60).replace(/\s+/g, ' ');
  };

  const INTERACTIVE =
    'button,a[href],input,select,textarea,[role="button"],[role="link"],' +
    '[role="switch"],[role="tab"],[role="checkbox"],[role="radio"]';

  const unnamed = [];
  const small = [];
  const lowContrast = [];

  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el)) continue;
    const name =
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      (el.textContent || '').trim() ||
      el.getAttribute('title');
    if (!name) unnamed.push(el.tagName + ' ' + (el.className || '').slice(0, 40));

    const r = el.getBoundingClientRect();
    // Only the innermost interactive element is the target; a wrapper that
    // merely contains one is not itself undersized.
    if (!el.querySelector(INTERACTIVE)) {
      if (r.width < 44 || r.height < 44) {
        small.push(`${describe(el)} — ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
  }

  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const text = (el.textContent || '').trim();
    if (!text) continue;
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const bg = backdrop(el);
    if (!fg || !bg) continue;
    const size = parseFloat(s.fontSize);
    const bold = Number(s.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const got = ratio(over(fg, bg), bg);
    if (got < need - 0.01) {
      lowContrast.push(
        `${text.slice(0, 40).replace(/\s+/g, ' ')} — ${got.toFixed(2)}:1 (needs ${need}) ${Math.round(size)}px`,
      );
    }
  }

  return { unnamed, small, lowContrast };
};

/**
 * How much bigger to make every word before looking for spill.
 *
 * **A proxy for Dynamic Type, and an honest one about its limits.** iOS scales
 * text through the OS; a browser cannot be asked to do that to a
 * react-native-web build, whose sizes are emitted as px. So this walks the
 * rendered tree and multiplies each computed `font-size`, then measures what
 * now hangs off the right edge.
 *
 * **`line-height` is scaled by the same factor, because that is what iOS
 * does.** `RCTTextAttributes.mm` reads
 * `_lineHeight * self.effectiveFontSizeMultiplier`, so a fixed
 * `lineHeight: 42` in the design tokens becomes 84 at 2x on a real phone and
 * the ratio holds. Scaling only `font-size` piles glyphs on top of one another
 * and produces screenshots that look like bugs the app does not have — which
 * is what the first version of this did.
 *
 * What it catches is layout that cannot absorb longer or taller text — fixed
 * widths, flex items that will not shrink, rows that only fit at one size.
 *
 * What it still cannot see is anything iOS does that a browser does not:
 * different font metrics, and text that opts out of scaling. The second is
 * **measured rather than assumed** — `allowFontScaling` and
 * `maxFontSizeMultiplier` appear nowhere in `src/`, so every `Text` in this app
 * scales. It is a floor, not a simulation.
 *
 * 2x rather than the 3.1x an iPhone can actually reach: the largest
 * accessibility sizes reflow text this app has not been designed against, and
 * a check that fails on every screen is one nobody runs. 2x is the setting a
 * great many people use every day.
 */
const TEXT_SCALE = 2;

/**
 * Anything hanging off the side once the text is doubled.
 *
 * Vertical overflow is deliberately not measured: screens scroll, and growing
 * downward is what they are supposed to do. Sideways is the failure — there is
 * no horizontal scroll, so whatever is out there simply cannot be read.
 *
 * Two things are skipped, and both would otherwise be reported as faults for
 * doing their job:
 *
 *  - **`<svg>`.** Engraved staves are drawn at a fixed size and scroll in
 *    their own container; their glyph elements carry font sizes that this
 *    would scale into nonsense.
 *  - **Anything inside a horizontal scroller.** The page pager on "Original
 *    pages" holds every photographed page side by side, so pages two and three
 *    are 330pt and 680pt off the right edge *by construction*. Content that
 *    extends past the screen inside something built to scroll sideways is the
 *    correct shape for wide content, not a spill.
 */
const spill = (scale) => {
  const scrollsSideways = (el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX;
      // Both conditions: `overflow-x: auto` on something that does not
      // actually overflow is not a sideways scroller, and suppressing under it
      // would hide a real spill in whatever it happens to wrap.
      if (
        (overflow === 'auto' || overflow === 'scroll') &&
        node.scrollWidth > node.clientWidth + 1
      ) {
        return true;
      }
    }
    return false;
  };

  for (const el of document.querySelectorAll('*')) {
    if (el.closest('svg')) continue;
    const style = getComputedStyle(el);
    const px = parseFloat(style.fontSize);
    if (!px) continue;
    el.style.fontSize = `${px * scale}px`;
    // Together, the way iOS scales them: a `line-height` left behind turns
    // every block of text into overlapping glyphs and reports heights the app
    // would never have.
    const line = parseFloat(style.lineHeight);
    if (line) el.style.lineHeight = `${line * scale}px`;
  }

  const width = document.documentElement.clientWidth;
  const found = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('svg') || scrollsSideways(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Only the innermost offender: a container is off-screen because its
    // child is, and naming both says the same thing twice.
    if ([...el.children].some((child) => child.getBoundingClientRect().right > width + 1)) {
      continue;
    }
    const over = Math.round(r.right - width);
    if (over > 1) {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      found.push(`${el.tagName.toLowerCase()} ${over}pt off the right edge${text ? ` — "${text}"` : ''}`);
    }
  }
  return found;
};

/**
 * The Chromium to drive.
 *
 * This environment pre-installs one at a fixed path and sets
 * `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, so Playwright's own resolution finds
 * nothing; anywhere else — a laptop, a CI runner — Playwright has downloaded
 * its own and knows where it is. Hardcoding the first path made both these
 * tools runnable in exactly one place, which is not a property a check should
 * have.
 */
function browserPath() {
  return existsSync('/opt/pw-browsers/chromium')
    ? { executablePath: '/opt/pw-browsers/chromium' }
    : {};
}

/**
 * Every route the app has a URL for, read out of `navigation/linking.ts`.
 *
 * **`ROUTES` above is hand-written, and a hand-written list of screens is the
 * thing that goes stale.** `linking.test.ts` already makes a new screen get a
 * URL — the browser's Back button walks out of the app from one that has none.
 * Nothing made a new screen get *audited*, so it would ship with a URL, a link,
 * and no check of its touch targets, its contrast or its accessible names.
 *
 * Read as text rather than imported: this file is `.mjs` running against a
 * built bundle and cannot import TypeScript, and the same technique is how
 * `describeError.test.ts` reads the sentences out of `client.ts`.
 */
function declaredPaths() {
  const source = readFileSync(
    new URL('../mobile/src/navigation/linking.ts', import.meta.url),
    'utf8',
  );
  const config = source.slice(source.indexOf('screens: {'));
  // One pattern covers both forms: `Today: ''` and `Library: 'library'`, and
  // the `path: 'pieces/:pieceId/bars/:measureNumber'` of the `{ path, parse }`
  // form used where a parameter is not a string. `parse` and `stringify` are
  // functions rather than string literals, so they do not match.
  const declared = [...config.matchAll(/^\s*\w+:\s*'([^']*)',$/gm)].map((m) => m[1]);
  return [...new Set(declared)];
}

/**
 * The declared paths no route in `ROUTES` visits.
 *
 * Compared as patterns, because a declared path carries `:pieceId` while the
 * audit visits a real fixture id. A query string is ignored — `?view=original`
 * is a second state of a route already covered, not a route of its own.
 */
function unvisitedRoutes() {
  const visited = ROUTES.map(([, path]) => path.split('?')[0]);
  return declaredPaths().filter((declared) => {
    const pattern = new RegExp(
      `^${declared.replace(/:[A-Za-z]+/g, '[^/]+').replace(/\//g, '\\/')}$`,
    );
    return !visited.some((path) => pattern.test(path));
  });
}

/**
 * Where the app keeps its device preferences on web.
 *
 * `data/preferences.ts` writes this key through `AsyncStorage`, which on
 * react-native-web is `localStorage` under the same name. Read off a running
 * build rather than assumed: after dismissing the tips screen it holds
 * `{"instrument":"violin","metronomeMode":"off","haptics":true,
 * "reduceMotion":false,"practiceSetupSeen":true}`.
 */
const PREFERENCES_KEY = 'intempo.preferences.v1';

/**
 * Put a route's screen into the state that route is *for*.
 *
 * **A route is not a screen.** `pieces/:pieceId/record` renders the first-take
 * tips until `practiceSetupSeen` is stored, so auditing the URL audited the
 * tips and never the recording controls — the same gap the post-scan states
 * had, where `pieces/:pieceId` was visited by a piece that had finished
 * reading. `unvisitedRoutes` cannot see this: it compares paths, and both
 * states share one.
 *
 * Seeded rather than clicked through, so each route stays a single `goto` and
 * a failure names a state rather than a sequence. This writes only what the
 * app itself writes when a musician dismisses the screen.
 */
/**
 * That a route in a state really reached that state.
 *
 * **The guard on `seed`.** Two entries above share one path and differ only by
 * a stored preference; if seeding stopped working, the second would quietly
 * audit the same screen as the first and pass, and the recording controls
 * would be back to never having been looked at while a line of output said
 * otherwise. Both record entries name a phrase only their own state renders,
 * so the pair proves it is two screens.
 *
 * Optional, because most routes have one state and a fragment there would be a
 * second copy of the screen's own copy, which rots.
 */
async function renders(page, fragment) {
  return page.evaluate(
    (text) => (document.getElementById('root')?.innerText ?? '').includes(text),
    fragment,
  );
}

async function seedPreferences(page, seed) {
  await page.addInitScript(
    ([key, value]) => {
      try {
        const held = JSON.parse(window.localStorage.getItem(key) ?? '{}');
        window.localStorage.setItem(key, JSON.stringify({ ...held, ...value }));
      } catch {
        // A browser refusing site data leaves the route on its default state,
        // which is a worse audit rather than a broken one.
      }
    },
    [PREFERENCES_KEY, seed],
  );
}

const browser = await chromium.launch(browserPath());
let failures = 0;

/**
 * Which routes to run, when only some of them make sense.
 *
 * `node tools/audit-a11y.mjs 4323 Today Library Insights Profile` audits four
 * names and skips the rest. There is exactly one caller with a reason: the
 * **empty-account** build (`EXPO_PUBLIC_FIXTURES=empty`), where every route
 * naming a `fixture-…` id points at a piece that does not exist, so sweeping
 * the whole list would measure a page of not-found states and call it
 * coverage.
 *
 * Skipping is announced, and `unvisitedRoutes` still runs on the **full**
 * list — a filtered run must not be able to report that every screen has an
 * audit when it looked at four.
 */
const ONLY = process.argv.slice(3);
const selected = ONLY.length
  ? ROUTES.filter(([name]) => ONLY.some((want) => name.includes(want)))
  : ROUTES;
if (ONLY.length) {
  console.log(
    `\n## Auditing ${selected.length} of ${ROUTES.length} routes ` +
      `(filtered by ${JSON.stringify(ONLY)})`,
  );
  if (selected.length === 0) {
    console.log('  Nothing matched — check the names against ROUTES.');
    failures += 1;
  }
}

const unvisited = unvisitedRoutes();
if (unvisited.length > 0) {
  console.log('\n## Routes with a URL and no audit');
  for (const path of unvisited) {
    console.log(`  /${path}`);
  }
  console.log(
    '  Add each to ROUTES with a fixture that reaches it. A screen nobody has\n' +
      '  audited is a screen nobody has looked at, which is how this app shipped\n' +
      '  a 32x44 back control on seven screens.',
  );
  failures += unvisited.length;
}

for (const [name, path, options = {}] of selected) {
  /*
   * **375pt, the narrowest iPhone this app can be installed on** — not the 390
   * of an iPhone 14/15. Every check here that depends on width gets stricter
   * for nothing, and the large-text check depends on it entirely.
   *
   * Measured across 19 routes at 2x text: clean at 375 and at 360 (a common
   * Android width), and four spills at **320** — iPhone 5 / SE 1st generation,
   * which current iOS does not run. Those four are single words wider than the
   * screen ("connection" in a doubled page title), which cannot be fixed by
   * layout: it needs a decision about shrinking or breaking the word, and that
   * is the owner's under §2. Holding the app to a width no supported phone has
   * would buy nothing and fail forever.
   */
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (options.seed) await seedPreferences(page, options.seed);
  try {
    await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1800);
  } catch (e) {
    console.log(`\n## ${name} (/${path})\n  COULD NOT LOAD: ${String(e).slice(0, 120)}`);
    failures += 1;
    await page.close();
    continue;
  }

  if (options.expect && !(await renders(page, options.expect))) {
    console.log(
      `\n## ${name} (/${path})\n  WRONG STATE: nothing on the page says ` +
        `${JSON.stringify(options.expect)} — this route did not reach the ` +
        'state it is listed for, so whatever was audited is not it.',
    );
    failures += 1;
    await page.close();
    continue;
  }
  const found = await page.evaluate(audit);
  // Last, and on the same page: it rewrites every font size in the document,
  // so nothing measured after it would be measuring the shipped app.
  const spilled = await page.evaluate(spill, TEXT_SCALE);
  const total =
    found.unnamed.length +
    found.small.length +
    found.lowContrast.length +
    spilled.length +
    errors.length;
  failures += total;

  console.log(`\n## ${name} (/${path}) — ${total === 0 ? 'clean' : total + ' finding(s)'}`);
  for (const e of errors) console.log(`  PAGE ERROR: ${e.slice(0, 120)}`);
  for (const u of found.unnamed) console.log(`  UNNAMED CONTROL: ${u}`);
  for (const s of new Set(found.small)) console.log(`  TARGET < ${MIN_TARGET}pt: ${s}`);
  for (const c of new Set(found.lowContrast)) console.log(`  CONTRAST: ${c}`);
  for (const o of new Set(spilled)) console.log(`  AT ${TEXT_SCALE}x TEXT: ${o}`);
  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} finding(s)`}`);
process.exit(failures === 0 ? 0 : 1);
