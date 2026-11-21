/**
 * The Board in a real browser: charts land on the Board with their question
 * and insight, are pinned to the dashboard one by one or several at once,
 * one undo takes a pin back, and the Board is saved with the project.
 *   npm run dev   (in another terminal)
 *   node e2e/board.mjs [outDir]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'e2e/screens';
const url = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const failures = [];
const errors = [];
function check(ok, what) {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
}
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(url);
await page.waitForSelector('.voice-dock');
const settled = () => page.waitForFunction(
  () => document.querySelector('.widget-card') && !document.querySelector('.widget-card .widget-loading, .widget-card [data-reloading="true"]'),
  null, { timeout: 15000 },
);

// Exploring: two questions land on the Board (the first start has the sample tables)
await page.evaluate(() => {
  const { store, workspace } = window.__studio;
  store.editDashboard({
    summary: 'MRR by region',
    add_widgets: [{
      id: 'mrr_by_region', title: 'MRR by Region', kind: 'bar', col_span: 6, asked_as: 'How is MRR split by region?',
      insight: 'North America leads with 54% of MRR',
      sql: "SELECT region, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY region ORDER BY mrr_usd DESC",
    }],
  }, { source: 'voice' }, 'board');
  store.editDashboard({
    summary: 'MRR by plan',
    add_widgets: [
      { id: 'mrr_by_plan', title: 'MRR by Plan', kind: 'donut', col_span: 6, asked_as: 'Which plan brings in what?', sql: "SELECT plan, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue WHERE month = '2026-10' GROUP BY plan ORDER BY mrr_usd DESC" },
      { id: 'mrr_trend', title: 'MRR Trend', kind: 'line', col_span: 12, asked_as: 'How did MRR develop?', sql: 'SELECT month, SUM(mrr_usd) AS mrr_usd FROM monthly_revenue GROUP BY month ORDER BY month' },
    ],
  }, { source: 'voice' }, 'board');
  workspace.showView('board');
});
await page.waitForSelector('.dashboard-view.is-board');
await settled();
check(await page.locator('.dashboard-view.is-board .widget-card').count() === 3, 'the Board shows its three charts');
check(await page.locator('.surface-pill[aria-pressed="true"]', { hasText: 'Board' }).count() === 1, 'the view switcher shows the Board');
check((await page.locator('.widget-card', { hasText: 'MRR by Region' }).locator('.board-asked').textContent()).includes('How is MRR split by region?'), 'a chart shows the question it answers');
check((await page.locator('.widget-card', { hasText: 'MRR by Region' }).locator('.board-insight').textContent()).includes('54%'), 'and what it showed');
check(await page.locator('.dashboard-view.is-board .widget-error').count() === 0, 'every Board chart draws');
check(await page.evaluate(() => window.__studio.store.scene.dashboard == null), 'the dashboard is untouched while exploring');
await page.screenshot({ path: `${out}/board-1-explore.png` });

// Pin one chart
await page.locator('.widget-card', { hasText: 'MRR by Region' }).getByRole('button', { name: 'Add to dashboard' }).click();
await page.waitForFunction(() => window.__studio.store.scene.dashboard?.widgets.length === 1);
check(true, 'pinning copies the chart to the dashboard');
check(await page.locator('.widget-card', { hasText: 'MRR by Region' }).getByRole('button', { name: 'On dashboard' }).isVisible(), 'the Board chart is marked as on the dashboard');

// Pick two and pin them together
await page.locator('.widget-card', { hasText: 'MRR by Plan' }).locator('h3').click();
await page.locator('.widget-card', { hasText: 'MRR Trend' }).locator('h3').click({ modifiers: ['Shift'] });
const pinTwo = page.getByRole('button', { name: 'Add 2 to dashboard' });
check(await pinTwo.isVisible(), 'picking two charts offers to add both');
await page.screenshot({ path: `${out}/board-2-picked.png` });
await pinTwo.click();
await page.waitForFunction(() => window.__studio.store.scene.dashboard?.widgets.length === 3);
check(true, 'both are copied in one go');

// One undo takes the last pin back
await page.evaluate(() => window.__studio.store.undo());
check(await page.evaluate(() => window.__studio.store.scene.dashboard?.widgets.length) === 1, 'one undo takes the last pin back');
await page.evaluate(() => window.__studio.store.redo());

// The dashboard has the copies, drawn
await page.locator('.surface-pill', { hasText: 'Dashboard' }).click();
await page.waitForSelector('.dashboard-view:not(.is-board)');
await settled();
const dashTitles = await page.locator('.dashboard-view:not(.is-board) .widget-card h3').allTextContents();
check(dashTitles.join('|') === 'MRR by Region|MRR by Plan|MRR Trend', `the dashboard has the pinned charts in order (${dashTitles.join(', ')})`);
check(await page.locator('.dashboard-view:not(.is-board) .board-asked, .dashboard-view:not(.is-board) .board-insight').count() === 0, 'the dashboard copies carry no Board notes');
check(await page.locator('.dashboard-view:not(.is-board) .widget-error').count() === 0, 'every dashboard copy draws');
await page.screenshot({ path: `${out}/board-3-dashboard.png` });

// Saved with the project
await page.waitForTimeout(700);
await page.reload();
await page.waitForSelector('.voice-dock');
const kept = await page.evaluate(() => {
  const b = window.__studio.store.scene.board;
  return { n: b?.widgets.length, asked: b?.widgets[0].askedAs, pinned: b?.widgets.filter((w) => w.promotedAs).length };
});
check(kept.n === 3 && kept.asked === 'How is MRR split by region?' && kept.pinned === 3, 'the Board, its questions and pins are there after a reload');

// An empty Board explains itself
await page.evaluate(() => {
  const { workspace } = window.__studio;
  workspace.addPage({ label: 'New page' });
  workspace.showView('board');
});
await page.waitForSelector('.board-empty');
check(await page.locator('.board-empty .surface-empty-card h2').textContent() === 'The Board is empty', 'an empty Board explains what it is for');

await browser.close();
if (errors.length > 0) console.log('Page errors:\n' + errors.join('\n'));
if (failures.length > 0 || errors.length > 0) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
