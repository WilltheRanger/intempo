import { chromium } from 'playwright';
const OUT = '/tmp/claude-0/-home-user-intempo/6a1c3a3b-1460-53e6-9bb2-b20325682688/scratchpad/sweep';
import { mkdirSync } from 'fs';
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ['today', ''],
  ['library', 'library'],
  ['insights', 'insights'],
  ['profile', 'profile'],
  ['piece-detail', 'pieces/fixture-bach-bwv1001'],
  ['piece-score', 'pieces/fixture-bach-bwv1001/score'],
  ['measure-edit', 'pieces/fixture-bach-bwv1001/bars/2'],
  ['record', 'pieces/fixture-bach-bwv1001/record'],
  ['reading-in-progress', 'pieces/fixture-reading-in-progress'],
  ['reading-failed', 'pieces/fixture-reading-failed'],
  ['warmup', 'warmup'],
  ['add-piece', 'add/scan'],
  ['scanner', 'scan'],
  ['help', 'help'],
  ['acknowledgements', 'acknowledgements'],
  ['legal-privacy', 'legal/privacy'],
  ['legal-terms', 'legal/terms'],
  ['account-email', 'account/email'],
  ['account-password', 'account/password'],
  ['account-delete', 'account/delete'],
  ['account-export', 'account/export'],
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const report = [];
for (const [name, path] of ROUTES) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
  try {
    await page.goto(`http://localhost:4301/${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    const info = await page.evaluate(() => {
      const root = document.getElementById('root');
      const texts = Array.from(document.querySelectorAll('div,span,h1,h2,h3,p'))
        .map((e) => (e.children.length === 0 ? (e.textContent || '').trim() : ''))
        .filter((t) => t.length > 0 && t.length < 120);
      return {
        rootHeight: root ? root.getBoundingClientRect().height : -1,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        texts: [...new Set(texts)].slice(0, 14),
      };
    });
    report.push({ name, path, ...info, errors });
  } catch (e) {
    report.push({ name, path, fatal: String(e).slice(0, 160), errors });
  }
  await page.close();
}
await browser.close();
for (const r of report) {
  const overflow = r.scrollW > r.clientW ? `  H-OVERFLOW ${r.scrollW}>${r.clientW}` : '';
  const height = r.rootHeight !== undefined ? ` h=${Math.round(r.rootHeight)}` : '';
  console.log(`\n### ${r.name} (/${r.path})${height}${overflow}`);
  if (r.fatal) console.log('  FATAL', r.fatal);
  if (r.errors?.length) r.errors.slice(0, 3).forEach((e) => console.log('  ' + e));
  if (r.texts) console.log('  ' + JSON.stringify(r.texts));
}
