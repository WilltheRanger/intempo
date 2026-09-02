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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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

const open = async (route) => {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
};

/** A pushed screen has no tab bar, which is correct rather than a fault. */
const onTabs = async () =>
  (await page.getByRole('tab', { name: 'Today' }).count()) > 0;

const tab = async (name) => {
  if (!(await onTabs())) await open('');
  await page.getByRole('tab', { name }).click({ timeout: 10000 });
  await page.waitForTimeout(900);
};

/** Tap the first control whose accessible name matches, and say where it went. */
const tapTo = async (label, name, expected) => {
  await page.getByRole('button', { name }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1000);
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
await page.waitForTimeout(900);
if ((await path()) === '/library') pass('browser back → /library');
else fail(`browser back → ${await path()}`);
await page.goForward();
await page.waitForTimeout(900);
if ((await path()).startsWith('/pieces/')) pass('browser forward → piece');
else fail(`browser forward → ${await path()}`);

await tab('Insights');
await tapTo('Insights piece row', /Caprice No\. 24/, /^\/pieces\/[^/]+$/);
await tab('Insights');
await tapTo('Insights next focus', /60 Studies/, /\/record$/);
await tab('Today');
await page.getByRole('button', { name: /Sonata No\. 1/ }).last().click({ timeout: 10000 });
await page.waitForTimeout(1000);
if ((await path()).startsWith('/analyses/')) pass(`Today take row → ${await path()}`);
else fail(`Today take row → ${await path()}, expected an analysis`);

// A deep link has no history behind it; back must still reach the parent.
await open('pieces/fixture-clef-change-study/bars/3');
await page.getByRole('button', { name: /back/i }).first().click({ timeout: 10000 });
await page.waitForTimeout(1000);
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

console.log('\n## Page errors');
if (errors.length === 0) pass('none across the whole walk');
else for (const e of errors) fail(`page error: ${e.slice(0, 120)}`);

await browser.close();
console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL — ${failures.length} finding(s)`}`);
process.exit(failures.length === 0 ? 0 : 1);
