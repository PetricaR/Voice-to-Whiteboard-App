/**
 * A dashboard on a slow warehouse shows the answer to the filter that is
 * selected now, never a late answer to the one selected before. The studio
 * server's query API is replaced, so no warehouse is needed.
 *   npm run dev   (in another terminal)
 *   node e2e/dashboard-race.mjs [outDir]
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
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// EMEA answers after 1.5 s, APAC at once
await page.route('**/api/data/query', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}');
  const region = body.params?.region;
  if (region === 'EMEA') await new Promise((r) => setTimeout(r, 1500));
  const value = region === 'EMEA' ? 111 : 222;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true, source: body.source, sql: body.sql, boundSql: body.sql, columns: ['revenue'], rows: [[value]],
      rowCount: 1, truncated: false, durationMs: 1, executedAt: new Date().toISOString(),
    }),
  });
});

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.voice-dock');

await page.evaluate(() => {
  const { store, workspace } = window.__studio;
  store.createDashboard({
    title: 'Warehouse',
    source: 'postgres',
    filters: [{ label: 'Region', param: 'region', options: ['EMEA', 'APAC'], value: 'EMEA' }],
    widgets: [{ id: 'rev', title: 'Revenue', kind: 'kpi', sql: 'SELECT SUM(amount) AS revenue FROM sales WHERE region = :region' }],
  }, { source: 'manual' });
  workspace.showView('dashboard');
});
await page.waitForSelector('.widget-card');
// While EMEA is still on its way, the user picks APAC
await page.waitForTimeout(200);
await page.evaluate(() => {
  window.__studio.store.editDashboard({ update_filters: [{ id: 'region', value: 'APAC' }] }, { source: 'manual' });
});
await page.waitForFunction(() => document.querySelector('.kpi-primary-value')?.textContent?.includes('222'), null, { timeout: 5000 })
  .catch(() => undefined);
check((await page.locator('.kpi-primary-value').textContent())?.includes('222'), 'the APAC answer is shown');
// Wait until the late EMEA answer has arrived
await page.waitForTimeout(2000);
const shown = await page.locator('.kpi-primary-value').textContent();
check(shown?.includes('222'), `the late EMEA answer does not replace it (shows ${shown?.trim()})`);
check(await page.locator('.widget-card [data-reloading="true"]').count() === 0, 'nothing is left loading');
check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
await page.screenshot({ path: `${out}/dashboard-race.png` });

await browser.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
