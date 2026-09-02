/**
 * Drive the shipping app through its own controls and check where it lands.
 *
 * **Everything else that checks this app is static.** The a11y audit renders a
 * route and measures it; the test suites exercise modules. Neither can see a
 * tap go to the wrong screen, and neither can see two screens state the same
 * fact differently — which is exactly what happened on 2026-09-02: Insights was
 * fixed to say "Your tempo wanders" and Today went on saying "You tend to rush"
 * about the same thirty days. It was found by driving the app in a browser, by
 * hand, which is not something that happens on every change.
 *
 * `DECISIONS.md` (2026-08-24) records that there is no React Native testing
 * library here, and CLAUDE.md names navigation as the part still untested. This
 * is the cheapest honest cover for it: the web build is the same tree, and a
 * route landing wrong here lands wrong on a phone.
 *
 * Two kinds of check, and the second is the one worth having:
 *
 *  - **Destinations.** Each tap ends on the route it should. A row that names a
 *    piece and opens a different one is invisible to every other check here.
 *  - **Agreement.** A fact stated on more than one screen must read the same on
 *    all of them. Screens drift apart one fix at a time.
 *
 * Run against a served fixtures build, the same way as the a11y audit:
 *
 *     cd mobile && npm run build:web        # with .env moved aside
 *     npx serve dist -l 4320 -s &
 *     node ../tools/walk-app.mjs 4320
 *
 * Exits non-zero on any failure, so it can gate a change.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// Resolved from `mobile/`, where playwright is installed with `--no-save` — a
// bare import would resolve against this directory instead. See the same note
// in `audit-a11y.mjs`, which the documented command failed on.
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = `http://localhost:${process.argv[2] ?? '4320'}`;

const failures = [];
const fail = (what) => {
  failures.push(what);
  console.log(`  FAIL  ${what}`);
};
const pass = (what) => console.log(`  ok    ${what}`);

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

const browser = await chromium.launch(browserPath());
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const path = () => page.evaluate(() => location.pathname);
const leaves = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter(
        (el) =>
          el.children.length === 0 &&
          (el.textContent ?? '').trim() &&
          !['STYLE', 'SCRIPT', 'TITLE', 'NOSCRIPT'].includes(el.tagName),
      )
      .map((el) => el.textContent.trim()),
  );

/**
 * Wait for a condition rather than for a duration.
 *
 * **Every wait here used to be a fixed sleep**, which is fine on an idle laptop
 * and is how a browser check becomes flaky the moment it runs somewhere loaded
 * — and a check that goes red at random is one people learn to ignore, which is
 * worse than not having it.
 */
const waitFor = async (what, predicate, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) {
      fail(`timed out waiting for ${what}`);
      return false;
    }
    await page.waitForTimeout(120);
  }
};

/** The app has mounted when React has put something under `#root`. */
const mounted = () =>
  page.evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) > 0);

const open = async (route) => {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitFor(`${route || '/'} to mount`, mounted);
  // Fixture sources resolve on a microtask, so one settled frame after mount is
  // enough — this is the only remaining fixed wait, and it is not a race with
  // the network.
  await page.waitForTimeout(400);
};

/** Wait until some rendered line satisfies `matches`. */
const waitForText = (what, matches, timeout) =>
  waitFor(what, async () => (await leaves()).some(matches), timeout);

/** A pushed screen has no tab bar, which is correct rather than a fault. */
const onTabs = async () =>
  (await page.getByRole('tab', { name: 'Today' }).count()) > 0;

/** Where each tab must land. Waiting for the destination, not for a change. */
const TAB_ROUTES = {
  Today: '/',
  Library: '/library',
  Insights: '/insights',
  Profile: '/profile',
};

const tab = async (name) => {
  // Returning to the tab layer already lands on `/`, so a tap on **Today**
  // then changes nothing — waiting for the path to differ timed out on a tab
  // that had worked perfectly. Wait for where it should be instead.
  if (!(await onTabs())) await open('');
  await page.getByRole('tab', { name }).click({ timeout: 10000 });
  await waitFor(`the ${name} tab to open`, async () => (await path()) === TAB_ROUTES[name]);
};

/** Tap the first control whose accessible name matches, and say where it went. */
const tapTo = async (label, name, expected) => {
  const from = await path();
  await page.getByRole('button', { name }).first().click({ timeout: 10000 });
  await waitFor(`${label} to navigate`, async () => (await path()) !== from);
  const landed = await path();
  if (expected.test(landed)) pass(`${label} → ${landed}`);
  else fail(`${label} → ${landed}, expected ${expected}`);
};

console.log('\n## Destinations');
await open('');
for (const [name, expected] of [
  ['Library', '/library'],
  ['Insights', '/insights'],
  ['Profile', '/profile'],
  ['Today', '/'],
]) {
  await tab(name);
  const landed = await path();
  if (landed === expected) pass(`tab ${name} → ${landed}`);
  else fail(`tab ${name} → ${landed}, expected ${expected}`);
}

await tab('Library');
await tapTo('Library row', /Sonata No\. 1/, /^\/pieces\/[^/]+$/);

// The web build must survive the browser's own history controls.
await page.goBack();
await waitFor('browser back', async () => (await path()) === '/library');
if ((await path()) === '/library') pass('browser back → /library');
else fail(`browser back → ${await path()}`);
await page.goForward();
await waitFor('browser forward', async () => (await path()).startsWith('/pieces/'));
if ((await path()).startsWith('/pieces/')) pass('browser forward → piece');
else fail(`browser forward → ${await path()}`);

await tab('Insights');
await tapTo('Insights piece row', /Caprice No\. 24/, /^\/pieces\/[^/]+$/);
await tab('Insights');
await tapTo('Insights next focus', /60 Studies/, /\/record$/);
await tab('Today');
await page.getByRole('button', { name: /Sonata No\. 1/ }).last().click({ timeout: 10000 });
await waitFor('the take row to open a verdict', async () => (await path()).startsWith('/analyses/'));
if ((await path()).startsWith('/analyses/')) pass(`Today take row → ${await path()}`);
else fail(`Today take row → ${await path()}, expected an analysis`);

// A deep link has no history behind it; back must still reach the parent.
await open('pieces/fixture-clef-change-study/bars/3');
await page.getByRole('button', { name: /back/i }).first().click({ timeout: 10000 });
await waitFor('back out of the bar editor', async () => (await path()).endsWith('/score'));
if ((await path()).endsWith('/score')) pass('deep-linked bar editor → back to the score');
else fail(`deep-linked bar editor → back went to ${await path()}`);

console.log('\n## Agreement between screens');

// The window headline. Today's "Practice snapshot" and the Insights title are
// the same claim about the same thirty days, from two components. They were
// allowed to disagree once.
await open('insights');
const insightsText = await leaves();
await open('');
const todayText = await leaves();

const HEADLINES = [
  'Your tempo wanders',
  'You tend to rush',
  'You tend to drag',
  'You drift slightly ahead',
  'You drift slightly behind',
  'You play steadily',
];
const headlineIn = (lines) => HEADLINES.find((h) => lines.some((l) => l === h)) ?? null;
const onInsights = headlineIn(insightsText);
const onToday = headlineIn(todayText);
if (onInsights === null || onToday === null) {
  fail(`window headline missing (insights=${onInsights}, today=${onToday})`);
} else if (onInsights === onToday) {
  pass(`window headline agrees: "${onInsights}"`);
} else {
  fail(`window headline: Insights says "${onInsights}", Today says "${onToday}"`);
}

// A single take is not a habit. The tendency wording must not appear in a row
// that describes one recording — that is the bug above, one level down.
const takeRow = (lines) => lines.find((l) => /·\s*\d+\s*BPM\s*·/.test(l)) ?? null;
for (const [screen, lines] of [['Insights', insightsText], ['Today', todayText]]) {
  const row = takeRow(lines);
  if (row === null) {
    fail(`${screen}: no recent-take row found to check`);
  } else if (HEADLINES.some((h) => row.includes(h))) {
    fail(`${screen}: a single take is worded as a habit — "${row}"`);
  } else {
    pass(`${screen} take row states a verdict, not a habit: "${row}"`);
  }
}

console.log('\n## Reading a real notation file');

/*
 * **The one path whose timeline cannot be wrong**, because a MusicXML file
 * *states* its durations rather than having them read off a photograph — so it
 * is the one worth driving with a real file rather than a fixture.
 *
 * What this catches that nothing else here can: the part is named from the
 * file's own `<part-name>`, never inferred from the clef. `bass_excerpt.musicxml`
 * declares **Cello** and is written in **F clef**, so an app that guessed from
 * the clef would say double bass and be wrong about the instrument a musician
 * plays — which `submitTake` sends and `analyze()` acts on.
 */
await open('add/notation');
const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
await page.getByRole('button', { name: /Choose a file/i }).first().click();
(await chooser).setFiles(
  new URL('../fixtures/musicxml/bass_excerpt.musicxml', import.meta.url).pathname,
);
await waitForText('the file to be read', (l) => l.includes('bass_excerpt.musicxml'));

const afterPick = await leaves();
const named = afterPick.find((l) => l.includes('bass_excerpt.musicxml'));
if (!named) fail('the chosen file was not acknowledged');
else if (!named.includes('Cello'))
  fail(`part named "${named}" — the file declares Cello; is it read from the clef?`);
else pass(`file read, part named from the file: "${named}"`);

// Saving needs a server. A fixtures build must say so rather than appear to
// succeed — a piece that looks saved and is not is worse than a refusal.
await page.getByRole('button', { name: /Add to library/i }).first().click();
await waitForText('the save to be answered', (l) => /needs the backend|sample data/i.test(l));
const afterSave = await leaves();
if (afterSave.some((l) => /needs the backend|sample data/i.test(l)))
  pass('saving without a backend is refused in words, not silently');
else fail('saving without a backend did not say so');

/*
 * **A file with more than one part must ask, and must not guess.**
 *
 * `violin_duo.musicxml` holds Violin I and Violin II **in the same clef**, so
 * nothing in the notation distinguishes them — the only honest source is the
 * name the file gives each part, and the only honest way to pick one is to ask.
 * A solo part must not see this question at all, which the single-part leg
 * above covers by getting straight to Title.
 */
await open('add/notation');
const duoChooser = page.waitForEvent('filechooser', { timeout: 10000 });
await page.getByRole('button', { name: /Choose a file/i }).first().click();
(await duoChooser).setFiles(
  new URL('../fixtures/musicxml/violin_duo.musicxml', import.meta.url).pathname,
);
await waitForText('the part question', (l) => /Which part do you play/i.test(l));

const asked = await leaves();
if (!asked.some((l) => /Which part do you play/i.test(l)))
  fail('a two-part file did not ask which part');
else if (!(asked.includes('Violin I') && asked.includes('Violin II')))
  fail(`both parts were not offered: ${JSON.stringify(asked)}`);
else pass('a two-part file asks which part, and offers both');

await page.getByRole('button', { name: /Violin II/ }).first().click();
await page.waitForTimeout(1500);
const chose = await leaves();
if (!chose.some((l) => l.includes('Violin II')))
  fail('the chosen part is not shown back');
else if (!chose.some((l) => /Change part/i.test(l)))
  fail('the chosen part cannot be changed');
else pass('the chosen part is shown back, and can be changed');

console.log('\n## Page errors');
if (errors.length === 0) pass('none across the whole walk');
else for (const e of errors) fail(`page error: ${e.slice(0, 120)}`);

await browser.close();
console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL — ${failures.length} finding(s)`}`);
process.exit(failures.length === 0 ? 0 : 1);
