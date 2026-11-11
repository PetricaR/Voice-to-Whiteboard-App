/**
 * Renders one widget of every chart type in the catalog on a single dashboard
 * and checks that each card draws something: no chart falls back to the error
 * boundary, none stays empty, and the page logs no errors. Runs offline on the
 * built-in sample data.
 *   npm run dev   (in another terminal)
 *   node e2e/charts.mjs [outDir]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'e2e/screens';
const url = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173/';
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.voice-dock');

const created = await page.evaluate(async () => {
  // The dev server serves the catalog module itself
  const { CHART_CATALOG } = await import('/src/engine/chartCatalog.ts');
  const { store, workspace } = window.__studio;
  const widgets = CHART_CATALOG.map((c, i) => ({ ...c.sampleWidget, id: `w_${i}_${c.kind}`, colSpan: 4 }));
  const res = store.createDashboard({ title: 'All chart types', source: 'local', widgets }, { source: 'manual' });
  workspace.showView('dashboard');
  return { ok: res.ok, errors: res.errors, kinds: CHART_CATALOG.length };
});
check(created.ok, `a dashboard with all ${created.kinds} chart types was created ${created.errors.join(' ')}`);

await page.waitForSelector('.widget-card');
await page.waitForFunction(() => !document.querySelector('.widget-card .widget-loading, .widget-card [data-reloading="true"]'), null, { timeout: 15000 })
  .catch(() => undefined);
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const kindOf = (card) => [...card.classList].find((x) => x.startsWith('kind-'))?.slice(5) ?? '?';
  const cards = [...document.querySelectorAll('.widget-card')];
  return {
    cards: cards.length,
    crashed: document.querySelector('.crash-screen') != null,
    failing: cards.filter((c) => c.querySelector('.widget-error'))
      .map((c) => `${kindOf(c)}: ${c.querySelector('.widget-error').textContent.trim().slice(0, 160)}`),
    // Empty: nothing was drawn, or the "no rows" placeholder is shown for sample data that has rows
    empty: cards.filter((c) => {
      const content = c.querySelector('.widget-card-content');
      return !c.querySelector('.widget-error') && (content == null || content.childElementCount === 0 || content.querySelector('.widget-empty') != null);
    }).map(kindOf),
  };
});
check(!report.crashed, 'the page did not fall back to the crash screen');
check(report.cards === created.kinds, `every chart type has a card (${report.cards} of ${created.kinds})`);
check(report.failing.length === 0, `no chart failed to draw ${report.failing.join(' | ')}`);
check(report.empty.length === 0, `no chart is empty ${report.empty.join(', ')}`);
check(errors.length === 0, `no page errors ${[...new Set(errors)].slice(0, 5).join(' | ')}`);
await page.screenshot({ path: `${out}/charts-all.png` });

// The gallery adds a chart and opens its controls
await page.getByRole('button', { name: 'Add chart' }).click();
await page.waitForSelector('.chart-gallery-dialog[open]');
check(await page.locator('.gallery-card').count() === created.kinds, 'the gallery lists every chart type');
await page.locator('.gallery-card').first().getByRole('button', { name: /Add Chart/ }).click();
await page.waitForSelector('.inspector-tab-btn');
check(await page.locator('.widget-card').count() === created.kinds + 1, 'adding from the gallery puts a new chart on the dashboard');
await page.screenshot({ path: `${out}/charts-gallery-added.png` });

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
