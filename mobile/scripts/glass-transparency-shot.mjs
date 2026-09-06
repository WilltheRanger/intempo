/**
 * Screenshot the floating control layer with Reduce Transparency off and on.
 *
 * The fallback is only ever seen by someone who has the setting on, which is
 * exactly why it goes unlooked-at. Playwright's `emulateMedia` does not carry
 * `prefers-reduced-transparency`, so this drives it over CDP instead — the same
 * switch the browser flips when the OS setting changes.
 *
 * Run against a served fixtures build, like `audit-a11y.mjs`:
 *
 *     cd mobile && npm run build:web    # with .env moved aside
 *     npx serve dist -l 4320 -s &
 *     node scripts/glass-transparency-shot.mjs 4320 /tmp/out
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');

const PORT = process.argv[2] ?? '4320';
const OUT = process.argv[3] ?? '.';
const BASE = `http://localhost:${PORT}`;

mkdirSync(OUT, { recursive: true });

// The pool in this environment carries a different Chromium build than the
// installed Playwright expects, so the binary is named rather than resolved.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {},
);
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

for (const reduce of [false, true]) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-transparency', value: reduce ? 'reduce' : 'no-preference' },
    ],
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const name = reduce ? 'reduced' : 'regular';
  await page.screenshot({ path: `${OUT}/glass-${name}.png` });

  // The measurement, not just the picture: what the tab bar's backdrop filter
  // resolves to, and whether the specular SVG is in the tree at all.
  const measured = await page.evaluate(() => {
    const filtered = [...document.querySelectorAll('*')].filter((el) => {
      const style = getComputedStyle(el);
      const value = style.backdropFilter || style.webkitBackdropFilter;
      return value && value !== 'none';
    });
    return {
      backdropFilters: filtered.map((el) => {
        const style = getComputedStyle(el);
        return style.backdropFilter || style.webkitBackdropFilter;
      }),
      matchesReduced: matchMedia('(prefers-reduced-transparency: reduce)').matches,
    };
  });
  console.log(`${name}:`, JSON.stringify(measured, null, 2));
  await page.close();
}

await browser.close();
