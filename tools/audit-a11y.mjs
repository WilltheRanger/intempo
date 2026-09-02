/**
 * Measure the shipping app against three accessibility floors.
 *
 * An `audit-a11y.mjs` was run once against the legacy `frontend/` tree on
 * 2026-08-20 and did not survive the rebuild into `mobile/`. This is that check
 * pointed at the app that actually ships, so it is one command again rather
 * than an argument.
 *
 * Three checks, chosen for this product rather than off a generic list:
 *
 *  - **Accessible names.** A control without one is unusable with VoiceOver.
 *  - **44pt targets.** The iOS floor, and more pointed here than in most apps:
 *    the person tapping has an instrument under their chin and a bow in the
 *    other hand.
 *  - **4.5:1 contrast.** Also more pointed than usual, since sheet music gets
 *    read under whatever light the room has.
 *
 * Run against a served fixtures build. Playwright is not a dependency of this
 * repository — install it alongside rather than adding it to `mobile`, which
 * ships to a phone:
 *
 *     cd mobile && npm run build:web        # with .env moved aside
 *     npx serve dist -l 4320 -s &
 *     npm i -D playwright --no-save
 *     node ../tools/audit-a11y.mjs 4320
 *
 * Exits non-zero when anything fails, so it can gate a change.
 */
import { chromium } from 'playwright';

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
  ['Score', 'pieces/fixture-clef-change-study/score'],
  ['Bar editor', 'pieces/fixture-clef-change-study/bars/3'],
  ['Record', 'pieces/fixture-bach-bwv1001/record'],
  ['Warmup', 'warmup'],
  ['Help', 'help'],
  ['Legal', 'legal/privacy'],
  ['Delete account', 'account/delete'],
  // Reachable, and both carry the reveal-password control that the two
  // *unreachable* auth screens also use — so this is where a regression in it
  // would be caught without a throwaway build.
  ['Change password', 'account/password'],
  ['Change email', 'account/email'],
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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failures = 0;

for (const [name, path] of ROUTES) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`${BASE}/${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1800);
  } catch (e) {
    console.log(`\n## ${name} (/${path})\n  COULD NOT LOAD: ${String(e).slice(0, 120)}`);
    failures += 1;
    await page.close();
    continue;
  }
  const found = await page.evaluate(audit);
  const total =
    found.unnamed.length + found.small.length + found.lowContrast.length + errors.length;
  failures += total;

  console.log(`\n## ${name} (/${path}) — ${total === 0 ? 'clean' : total + ' finding(s)'}`);
  for (const e of errors) console.log(`  PAGE ERROR: ${e.slice(0, 120)}`);
  for (const u of found.unnamed) console.log(`  UNNAMED CONTROL: ${u}`);
  for (const s of new Set(found.small)) console.log(`  TARGET < ${MIN_TARGET}pt: ${s}`);
  for (const c of new Set(found.lowContrast)) console.log(`  CONTRAST: ${c}`);
  await page.close();
}

await browser.close();
console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} finding(s)`}`);
process.exit(failures === 0 ? 0 : 1);
