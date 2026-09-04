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
import { fileURLToPath } from 'node:url';
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

/**
 * A real page of engraved music from this repository, by name.
 *
 * Relative to this file rather than to the working directory: the CI job runs
 * from `mobile/`, and a path built from `process.cwd()` would resolve there.
 */
const PAGE_FIXTURE = (name) =>
  fileURLToPath(new URL(`../fixtures/scores/${name}`, import.meta.url));

const browser = await chromium.launch(browserPath());
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const path = () => page.evaluate(() => location.pathname);
/** Every leaf of visible text, on `where` — the main page unless one is given. */
const leaves = (where = page) =>
  where.evaluate(() =>
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
const waitFor = async (what, predicate, timeout = 15000, on = page) => {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) {
      fail(`timed out waiting for ${what}`);
      return false;
    }
    // Ticks on the page being watched, so a second tab is not paced by the
    // first one's event loop.
    await on.waitForTimeout(120);
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

console.log('\n## Photographing a piece');

/**
 * **The scan flow, populated — the largest area no sweep had ever rendered.**
 *
 * Four screens sit between a photograph and a saved piece, and every check in
 * this repository had only ever seen their *empty* states, because reaching
 * them by URL leaves `captureSession` empty and the scanner needs a camera the
 * container does not have.
 *
 * Import is the way in. On web `expo-image-picker` opens a real
 * `<input type="file">`, so Playwright's file chooser reaches it, and pages
 * picked there go into the same session the scanner fills — the component's own
 * docstring says so, and this is what makes that claim checkable. The images
 * are the repository's own fixture pages, so the thumbnails are real engraved
 * music rather than a coloured rectangle.
 */
{
  const scan = await browser.newPage({ viewport: { width: 390, height: 844 } });
  scan.on('pageerror', (e) => errors.push(e.message));
  await scan.goto(`${BASE}/add/import`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await scan.waitForTimeout(1500);

  const chooser = scan.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
  await scan.getByText('Choose images').first().click({ timeout: 15000 });
  const picker = await chooser;

  if (!picker) {
    fail('the image picker never opened a file input');
  } else {
    await picker.setFiles([
      PAGE_FIXTURE('01_simple_printed.jpg'),
      PAGE_FIXTURE('02_medium_printed.jpg'),
    ]);
    await waitFor(
      'the imported pages to reach the review list',
      async () => (await scan.evaluate(() => location.pathname)) === '/scan/pages',
      20000,
      scan,
    );

    const onReview = await leaves(scan);
    // Page order is the one thing this screen exists to let someone fix, and
    // the upload sends the list in the order shown — see `lib/scan/drag.ts`.
    const numbered = onReview.filter((l) => /^Page \d+$/.test(l));
    const inOrder = numbered.join(',') === 'Page 1,Page 2';
    if (!inOrder) fail(`the review list read ${JSON.stringify(numbered)}`);
    else if (!onReview.some((l) => /^2 pages$/.test(l)))
      fail('the review screen does not say how many pages it has');
    else pass('two imported pages arrive in order, and the count agrees');

    /*
     * **Guarded, and that is not defensiveness for its own sake.** Proving this
     * leg catches a regression meant breaking the session on purpose, and the
     * unguarded `click` below then threw a Playwright timeout that killed the
     * whole run — so a real regression here would have produced a stack trace
     * instead of this file's own report, and silently skipped both microphone
     * legs after it. A check that hides the checks behind it is worse than the
     * bug it found.
     */
    const continued = inOrder
      ? await scan
          .getByText(/Continue with 2 pages/)
          .first()
          .click({ timeout: 15000 })
          .then(() => true, () => false)
      : false;

    if (!continued) {
      fail('the review screen offered no way to send the pages on');
    } else {
      await waitFor(
        'the upload screen',
        async () => (await scan.evaluate(() => location.pathname)) === '/scan/sending',
        20000,
        scan,
      );
      await scan.waitForTimeout(2500);

      // No backend in this build, so the honest outcome is a refusal that names
      // something a musician can actually do instead.
      const sending = await leaves(scan);
      const said = sending.find((l) => /needs the backend|could not|sample data/i.test(l));
      if (!said) fail('sending pages without a backend said nothing');
      else if (!sending.some((l) => /manual/i.test(l)))
        fail(`the refusal names no route that exists: "${said.slice(0, 60)}"`);
      else if (!sending.some((l) => /Back to pages/i.test(l)))
        fail('the refusal offers no way back to the pages just photographed');
      else pass(`sending without a backend is refused, with a way on: "${said.slice(0, 58)}…"`);
    }
  }
  await scan.close();
}

console.log('\n## After a scan, before there is any notation');

/*
 * **The two screens every scan passes through, and the two states no sweep had
 * ever opened.** `POST /v1/scores` returns before a single note is read, so a
 * musician who finishes a scan lands on a piece that is `reading` and may end
 * on one that `failed` — and both live at routes the audit already visits, on
 * pieces it does not. A route list cannot see a state, which is why these are
 * here rather than in `audit-a11y.mjs` alone.
 *
 * What each leg is actually protecting:
 *
 *  - **Progress is measured, never animated toward a guess** (CLAUDE.md). The
 *    worker reports a stage; the app prints it. A build that fell back to a
 *    word of its own — "Transcribing the notation." is right there as the
 *    fallback — would look identical to a musician and would have stopped
 *    telling them anything.
 *  - **The reason a page failed is written for a musician, by the server.**
 *    `_FAILURE_REASONS` exists because the same sentence was got wrong three
 *    times, twice by blaming a photograph for a fault on our side. All of that
 *    work reaches nobody if the screen substitutes wording of its own.
 */
await open('pieces/fixture-reading-in-progress');
const readingPiece = await leaves();
const stageOnPiece = readingPiece.find((l) => /Reading stave \d+ of \d+/.test(l));
if (!stageOnPiece)
  fail(
    `a piece being read shows no measured stage: ${JSON.stringify(readingPiece.slice(0, 8))}`,
  );
else pass(`a piece being read names the stage the worker reached: "${stageOnPiece}"`);

await tapTo(
  'the reading row',
  /Reading this page/i,
  /^\/pieces\/fixture-reading-in-progress\/score$/,
);

// **Agreement**, the kind of check worth having: the same fact on two screens.
// These read the same field from the same query, and a screen that computed
// its own would drift one fix at a time.
const stageOnScore = (await leaves()).find((l) => /Reading stave \d+ of \d+/.test(l));
if (stageOnScore !== stageOnPiece)
  fail(`stage reads "${stageOnPiece}" on the piece and "${stageOnScore}" on the score`);
else pass(`both screens name the same stage: "${stageOnScore}"`);

await open('pieces/fixture-reading-failed/score');
const failedScore = await leaves();
// Verbatim, and that is the assertion. The fixture's reason is one the server
// really writes, so a screen that paraphrased it would be paraphrasing every
// sentence in `_FAILURE_REASONS`.
const reason = failedScore.find((l) =>
  l.includes('A flatter, better-lit shot of the page usually fixes it.'),
);
if (!reason)
  fail(
    `the server's own reason did not reach the screen: ${JSON.stringify(failedScore.slice(0, 8))}`,
  );
else pass('a failed page shows the reason the server wrote, word for word');

// Three ways on, and none of them a dead end: read it again with the pages
// already stored, photograph it again, or pick different files. A failure
// screen with no route out is where a piece goes to be abandoned.
const waysOn = [/Try reading it again/i, /Take new photographs/i, /Choose different images/i];
const missing = waysOn.filter((w) => !failedScore.some((l) => w.test(l)));
if (missing.length > 0) fail(`a failed page offers no ${missing.join(', ')}`);
else pass('and offers three ways on: read it again · new photographs · different images');

// The piece survives the failure. Losing the title and tempo because the
// notation could not be read would throw away everything the musician typed.
if (!failedScore.some((l) => /still in your library/i.test(l)))
  fail('a failed page does not say the piece is still in the library');
else pass('and says the piece itself is still there');

console.log('\n## Repairing a bar the reader got wrong');

/*
 * **The answer to every misread bar, and the walk only ever opened it.**
 * `MeasureEditScreen` is where a musician fixes what the reader got wrong, and
 * the number they steer by is the beat count: they change durations until the
 * bar adds up, then save. `describeBeats` and `timeSignaturesByMeasure` are
 * both unit-tested — what is not is the wiring between them and the controls,
 * which lives in a `.tsx` and is therefore the kind of rule this project
 * repeatedly finds nothing checking.
 *
 * The failure worth catching is a count that stops moving. A musician would go
 * on pressing durations until the bar looked right, save a bar that does not
 * add up believing it does, and every onset after it shifts — which
 * `MeasureEditScreen`'s own comment calls the one kind of correction that
 * cannot be seen by looking at the bar afterwards.
 */
await open('pieces/fixture-clef-change-study/bars/3');
const barOpened = await leaves();
if (!barOpened.some((l) => /^4 of 4 beats$/.test(l)))
  fail(`the bar editor opened without a beat count: ${JSON.stringify(barOpened.slice(0, 10))}`);
else if (!barOpened.some((l) => /adds up/i.test(l)))
  fail('a bar that adds up does not say so');
else pass('a bar that adds up opens saying "4 of 4 beats" and so');

// Lengthening the selected note. **Both halves asserted**: a count that moves
// while the sentence beside it still says the bar adds up is the same
// screen-contradicts-itself fault the agreement checks above exist for.
await page.getByRole('button', { name: 'Half', exact: true }).first().click();
await waitFor('the beat count to follow the edit', async () =>
  (await leaves()).some((l) => /^5 of 4 beats$/.test(l)),
);
const lengthened = await leaves();
if (!lengthened.some((l) => /^5 of 4 beats$/.test(l)))
  fail('lengthening a note did not change the beat count');
else if (lengthened.some((l) => /adds up/i.test(l)))
  fail('the bar says it adds up at 5 of 4 beats');
else pass('lengthening a note reads 5 of 4 beats, and it stops saying it adds up');

await page.getByRole('button', { name: 'Delete this note' }).first().click();
await waitFor('the beat count to follow the delete', async () =>
  (await leaves()).some((l) => /^3 of 4 beats$/.test(l)),
);
if ((await leaves()).some((l) => /^3 of 4 beats$/.test(l)))
  pass('deleting a note takes it the other way, to 3 of 4 beats');
else fail('deleting a note did not change the beat count');

/*
 * **And the edit survives a refused save**, which is the half that costs a
 * musician real work. A screen that navigated away on a failed save would
 * throw out every correction they had just made, and there is nowhere to get
 * them back from.
 */
await page.getByRole('button', { name: 'Save this bar' }).first().click();
await waitForText('the save to be answered', (l) =>
  /needs the backend|sample data/i.test(l),
);
const afterBarSave = await leaves();
const refusal = afterBarSave.find((l) => /needs the backend|sample data/i.test(l));
if (!refusal) fail('saving a correction without a backend said nothing');
else if (!/\/bars\/3$/.test(await path()))
  fail(`a refused save left the editor for ${await path()}, losing the edit`);
else if (!afterBarSave.some((l) => /^3 of 4 beats$/.test(l)))
  fail('a refused save discarded the edit that was on screen');
else pass(`a refused save keeps the edit and says why: "${refusal.slice(0, 52)}…"`);

console.log('\n## Telling the app it got a bar wrong');

/*
 * **`POST /v1/analyses/:id/corrections` had no client for the life of this
 * project** — built, tested, owner-scoped, and never called, while its router
 * docstring called it the only route out of Batch 3's untuned thresholds. This
 * leg is here so it cannot go quiet again: a control nobody has driven is a
 * control nobody has checked, which is the doctrine the microphone legs below
 * were written from.
 *
 * Three things, all of which were once separately wrong somewhere in this app:
 * the question appears only on a bar that was actually judged; it does not
 * appear on one the pipeline refused to judge; and sending it without a
 * backend is refused in words rather than silently swallowed.
 */
{
  await open('analyses/fixture-take-1');

  // Measure 5 is one the app called rushing. Measure 11 is "Not timed".
  const judged = page.getByRole('button', { name: /Measure 5/ }).first();
  await judged.click({ timeout: 15000 });

  const asked = await page
    .getByText('What actually happened?')
    .first()
    .isVisible()
    .catch(() => false);
  if (asked) pass('a judged bar asks what actually happened');
  else fail('a judged bar does not offer the question');

  const offered = await leaves();
  const words = ['On tempo', 'Rushing', 'Dragging', 'Not sure'].filter((w) =>
    offered.includes(w),
  );
  if (words.length === 4) pass(`all four answers offered: ${words.join(' · ')}`);
  else fail(`only ${words.length} of four answers offered`);

  // A bar under a written change was never judged, so there is nothing to
  // agree or disagree with — asking would be asking a musician to adjudicate a
  // measurement that was never made.
  const untimed = page.getByRole('button', { name: /Measure 11/ }).first();
  const untimedIsAButton = await untimed.count().then((n) => n > 0).catch(() => false);
  if (!untimedIsAButton) {
    pass('an untimed bar is not a button, so it cannot be asked about');
  } else {
    await untimed.click({ timeout: 5000 }).catch(() => {});
    const stillOne = (await leaves()).filter((l) => l === 'What actually happened?');
    if (stillOne.length <= 1) pass('an untimed bar does not ask the question');
    else fail('an untimed bar offered the correction question');
  }

  // The fixture build has no account to attach a correction to, so this must
  // say so rather than acknowledging something it did not record.
  await page.getByRole('button', { name: /^Dragging$/ }).first().click({ timeout: 10000 });
  await waitForText(
    'the correction to be answered',
    (l) => /needs the backend|sample data/i.test(l),
    10000,
  );
  const said = (await leaves()).find((l) => /needs the backend|sample data/i.test(l));
  if (said) pass(`sending without a backend is refused in words: "${said.slice(0, 52)}…"`);
  else fail('a correction with no backend was neither sent nor refused in words');
}

console.log('\n## Downloading your own data');

/*
 * **The screen that used to say the export was ready when it was not.**
 *
 * `saveAccountExport` resolved for a dismissed share sheet, and on iOS it
 * shared the JSON as a chat message rather than a file — so "Download your
 * data" sat above something that could not be downloaded and reported success
 * either way. That is fixed and unit-tested; what no unit test can see is the
 * screen, and the one claim worth driving is the negative: with nothing to
 * fetch, the app must say so and must **not** say the export is ready.
 */
{
  await open('account/export');

  await page.getByRole('button', { name: /Prepare download/ }).first().click({ timeout: 15000 });
  await waitForText(
    'the export to be answered',
    (l) => /needs the backend|sample data/i.test(l),
    15000,
  );

  const lines = await leaves();
  const said = lines.find((l) => /needs the backend|sample data/i.test(l));
  if (said) pass(`an export with no backend is refused in words: "${said.slice(0, 52)}…"`);
  else fail('an export with no backend was neither prepared nor refused in words');

  if (!lines.some((l) => /Your export is ready/i.test(l))) {
    pass('and does not claim the export is ready');
  } else {
    fail('the screen claimed the export was ready when nothing was downloaded');
  }
}

console.log('\n## A refused microphone');

/*
 * **The most common thing that goes wrong on a first take**, and nothing
 * exercised it. The two failures are different and the app must not confuse
 * them: no device is a fact about the hardware, a refusal is a permission the
 * musician can grant. Telling someone whose browser is blocking the microphone
 * that their device hasn't got one sends them looking for the wrong thing.
 *
 * Stubbed rather than driven, because a headless browser cannot produce a real
 * refusal: Playwright has no "deny" for a permission prompt, and the prompt
 * simply never resolves. `NotAllowedError` is exactly what Chromium rejects
 * with when someone taps "Don't Allow" — the branch this reaches is the same
 * one a real refusal takes.
 *
 * This container has no audio input at all, so the *other* branch is the one
 * that shows up unstubbed: `getUserMedia` rejects `NotFoundError` and the app
 * correctly says no microphone is available. That is a true statement here and
 * would be the wrong one for a refusal, which is the whole point of the pair.
 */
{
  const denied = await browser.newPage({ viewport: { width: 390, height: 844 } });
  denied.on('pageerror', (e) => errors.push(e.message));
  await denied.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await denied.goto(`${BASE}/pieces/fixture-bach-bwv1001/record`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await denied
    .getByText('Set tempo & record')
    .first()
    .click({ timeout: 15000 })
    .catch(() => {});
  await denied.getByRole('button', { name: /Start recording/i }).first().click({ timeout: 15000 });

  const said = await (async () => {
    const deadline = Date.now() + 15000;
    for (;;) {
      const lines = await denied.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim())
          .map((el) => el.textContent.trim()),
      );
      const hit = lines.find((l) => /microphone/i.test(l));
      if (hit || Date.now() > deadline) return hit ?? null;
      await denied.waitForTimeout(150);
    }
  })();

  if (said === null) fail('a refused microphone said nothing at all');
  else if (/no microphone is available/i.test(said))
    fail(`a refused microphone was reported as a missing one — "${said}"`);
  else if (!/blocking|allow/i.test(said))
    fail(`a refused microphone said "${said}", which names no way out`);
  else pass(`a refused microphone names the way out: "${said.slice(0, 60)}…"`);
  await denied.close();
}

/**
 * **A microphone that is granted, connected, and silent.**
 *
 * The one recording failure the app cannot see coming from an error: a muted
 * input, a device recording from a source with nothing routed to it, or a
 * permission granted and then revoked mid-take. `getUserMedia` resolves, the
 * graph runs, and every sample that arrives is zero.
 *
 * `createMediaStreamDestination()` with nothing connected to it is exactly
 * that — a real `MediaStream` carrying a real track that produces silence — so
 * this exercises the recorder's actual worklet rather than a stub of it. The
 * message it should produce has existed on this screen all along and could
 * never fire: the check was `durationOf(chunks) === 0`, and a muted microphone
 * delivers samples like any other. Without this leg it is a message nobody has
 * seen.
 */
console.log('\n## A microphone that is on and silent');
{
  const quiet = await browser.newPage({ viewport: { width: 390, height: 844 } });
  quiet.on('pageerror', (e) => errors.push(e.message));
  await quiet.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      // Nothing is connected to this destination, so its track carries
      // silence — the samples a muted input delivers.
      return context.createMediaStreamDestination().stream;
    };
  });
  await quiet.goto(`${BASE}/pieces/fixture-bach-bwv1001/record`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await quiet
    .getByText('Set tempo & record')
    .first()
    .click({ timeout: 15000 })
    .catch(() => {});
  await quiet.getByRole('button', { name: /Start recording/i }).first().click({ timeout: 15000 });

  // Long enough that the worklet has certainly posted, so "nothing arrived" is
  // ruled out and the take really is samples that are all zero.
  await quiet.waitForTimeout(2500);
  const stop = quiet.getByRole('button', { name: /Stop/i }).first();
  await stop.click({ timeout: 15000 }).catch(() => {});

  const said = await (async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      const lines = await quiet.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim())
          .map((el) => el.textContent.trim()),
      );
      const hit = lines.find((l) => /silent|muted/i.test(l));
      if (hit || Date.now() > deadline) return hit ?? null;
      await quiet.waitForTimeout(200);
    }
  })();

  if (said === null)
    fail('a silent take was accepted — it would have cost an upload and a free analysis');
  else pass(`a silent take is refused before it is sent: "${said.slice(0, 70)}…"`);
  await quiet.close();
}

console.log('\n## Page errors');
if (errors.length === 0) pass('none across the whole walk');
else for (const e of errors) fail(`page error: ${e.slice(0, 120)}`);

await browser.close();
console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL — ${failures.length} finding(s)`}`);
process.exit(failures.length === 0 ? 0 : 1);
