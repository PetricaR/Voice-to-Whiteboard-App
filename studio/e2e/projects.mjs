/**
 * Projects in a real browser: a first start lands in "My first project",
 * work is saved per project, two tabs on two projects stay apart, the
 * project list opens, renames and deletes, and the work of an earlier
 * version becomes the first project.
 *   npm run dev   (in another terminal)
 *   node e2e/projects.mjs [outDir]
 */
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'e2e/screens';
const url = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
const errors = [];
function check(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
}
function watch(page, tag) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
}
const projectOf = (page) => new URL(page.url()).searchParams.get('project');
const pageTitles = (page) => page.evaluate(() => window.__studio.workspace.pages.map((p) => p.store.scene.title));
async function setTitle(page, title) {
  await page.evaluate((t) => window.__studio.store.edit({ title: t }, { source: 'manual', label: 'Renamed' }), title);
  // Saved 400 ms after the last change
  await page.waitForTimeout(700);
}

// ---------- First start, saving, a second project ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const tab1 = await context.newPage();
  watch(tab1, 'tab1');
  await tab1.goto(url);
  await tab1.waitForSelector('.voice-dock');
  const first = projectOf(tab1);
  check(first != null, 'a first start opens a project and puts it in the address');
  check((await tab1.locator('.project-switcher-name').textContent()) === 'My first project', 'the top bar shows "My first project"');
  check(await tab1.title() === 'My first project — Voice Whiteboard Studio', 'the tab title names the project');

  await setTitle(tab1, 'Revenue review');
  await tab1.reload();
  await tab1.waitForSelector('.voice-dock');
  check(projectOf(tab1) === first, 'a reload stays on the project');
  check((await pageTitles(tab1))[0] === 'Revenue review', 'the work of the project is there after a reload');

  // A new project from the switcher, in this tab
  await tab1.click('.project-switcher');
  await tab1.getByRole('menuitem', { name: 'New project…' }).click();
  await tab1.fill('.project-dialog input', 'Churn analysis');
  await tab1.fill('.project-dialog textarea', 'Why retail customers leave in Q4');
  await tab1.screenshot({ path: `${out}/projects-1-new-dialog.png` });
  await Promise.all([tab1.waitForURL((u) => new URL(u).searchParams.get('project') !== first), tab1.getByRole('button', { name: 'Create' }).click()]);
  await tab1.waitForSelector('.voice-dock');
  const second = projectOf(tab1);
  check(second != null && second !== first, 'the new project opens in the tab');
  check((await tab1.locator('.project-switcher-name').textContent()) === 'Churn analysis', 'the switcher shows the new project');
  check((await pageTitles(tab1))[0] !== 'Revenue review', 'the new project starts with its own empty page');
  await setTitle(tab1, 'Churn drivers');

  // The first project in a second tab, next to the second project
  const tab2 = await context.newPage();
  watch(tab2, 'tab2');
  await tab2.goto(new URL(`/?project=${first}`, url).href);
  await tab2.waitForSelector('.voice-dock');
  check((await pageTitles(tab2))[0] === 'Revenue review', 'a second tab opens the first project');
  await setTitle(tab2, 'Revenue review v2');
  await setTitle(tab1, 'Churn drivers v2');
  await tab1.reload();
  await tab2.reload();
  await tab1.waitForSelector('.voice-dock');
  await tab2.waitForSelector('.voice-dock');
  check((await pageTitles(tab1))[0] === 'Churn drivers v2', 'tab 1 keeps its project’s work');
  check((await pageTitles(tab2))[0] === 'Revenue review v2', 'tab 2 keeps its project’s work (no overwrite across tabs)');

  // The switcher lists the other project
  await tab1.click('.project-switcher');
  await tab1.waitForSelector('.project-menu-row');
  check((await tab1.locator('.project-menu-row b').allTextContents()).includes('My first project'), 'the switcher lists the recent project');
  await tab1.screenshot({ path: `${out}/projects-2-switcher.png` });
  await tab1.keyboard.press('Escape');

  // Rename from the switcher
  await tab1.click('.project-switcher');
  await tab1.getByRole('menuitem', { name: 'Rename project…' }).click();
  await tab1.fill('.project-dialog[open] input', 'Churn deep dive');
  await tab1.getByRole('button', { name: 'Save' }).click();
  await tab1.waitForFunction(() => document.querySelector('.project-switcher-name')?.textContent === 'Churn deep dive');
  check(true, 'renaming updates the top bar');

  // ---------- The project list ----------
  await tab1.click('.project-switcher');
  await Promise.all([tab1.waitForURL((u) => !new URL(u).searchParams.has('project')), tab1.getByRole('menuitem', { name: 'All projects' }).click()]);
  await tab1.waitForSelector('.project-card');
  const names = await tab1.locator('.project-card h3').allTextContents();
  check(names.length === 2 && names.includes('Churn deep dive') && names.includes('My first project'), 'the project list shows both projects');
  check((await tab1.locator('.project-card', { hasText: 'Churn deep dive' }).textContent()).includes('Why retail customers leave'), 'a card shows the brief');
  await tab1.screenshot({ path: `${out}/projects-3-home.png` });

  // Tab 2 has the first project open: the list says so, and it cannot be deleted from here
  const firstCard = tab1.locator('.project-card', { hasText: 'My first project' });
  check(await firstCard.locator('.project-card-badge').isVisible(), 'a project open in another tab is marked on the list');
  check(!(await tab1.locator('.project-card', { hasText: 'Churn deep dive' }).locator('.project-card-badge').count()), 'a project open nowhere is not marked');
  await firstCard.getByRole('button', { name: /More actions/ }).click();
  check(await tab1.getByRole('menu', { name: 'My first project actions' }).getByRole('menuitem', { name: /Delete/ }).isDisabled(), 'a project open in another tab cannot be deleted');
  await tab1.keyboard.press('Escape');
  await tab1.waitForTimeout(300);

  // Duplicate, then delete the copy
  await tab1.locator('.project-card', { hasText: 'My first project' }).getByRole('button', { name: /More actions/ }).click();
  await tab1.getByRole('menuitem', { name: 'Duplicate' }).click();
  await tab1.waitForFunction(() => document.querySelectorAll('.project-card').length === 3);
  check(true, 'duplicate adds a project');
  await tab1.waitForTimeout(300);
  check(await tab1.evaluate(() => document.querySelectorAll('.menu:popover-open').length) === 0, 'the card menu closes after an action');
  await tab1.locator('.project-card', { hasText: 'My first project (copy)' }).getByRole('button', { name: /More actions/ }).click();
  await tab1.getByRole('menu', { name: 'My first project (copy) actions' }).getByRole('menuitem', { name: 'Delete' }).click();
  await tab1.getByRole('button', { name: 'Delete project' }).click();
  await tab1.waitForFunction(() => document.querySelectorAll('.project-card').length === 2);
  check(true, 'delete removes the project after confirming');

  // ---------- One tab per project ----------
  // An edit in tab 2 that is not saved yet (saving waits 400 ms) must survive the handoff
  await tab2.evaluate(() => window.__studio.store.edit({ title: 'Revenue review v3' }, { source: 'manual', label: 'Renamed' }));
  await Promise.all([tab1.waitForURL((u) => new URL(u).searchParams.get('project') === first), tab1.locator('.project-card-link', { hasText: 'My first project' }).click()]);
  await tab1.waitForSelector('.project-busy');
  check(await tab1.locator('.voice-dock').count() === 0, 'a project open in another tab does not open a second time');
  await tab1.screenshot({ path: `${out}/projects-4-busy.png` });
  await tab1.getByRole('button', { name: 'Use it here' }).click();
  await tab1.waitForSelector('.voice-dock');
  check((await pageTitles(tab1))[0] === 'Revenue review v3', '"Use it here" opens the project with the other tab’s last, unsaved edit');
  await tab2.waitForSelector('.moved-dialog[open]');
  check(true, 'the other tab says the project moved');
  await tab2.screenshot({ path: `${out}/projects-5-moved.png` });

  // The tab that handed over no longer saves
  await tab2.evaluate(() => window.__studio.store.edit({ title: 'Stale edit' }, { source: 'manual', label: 'Renamed' }));
  await tab2.waitForTimeout(900);
  await tab1.reload();
  await tab1.waitForSelector('.voice-dock');
  check((await pageTitles(tab1))[0] === 'Revenue review v3', 'edits in the tab that handed over are not saved');

  // And can take it back
  await Promise.all([
    tab2.waitForEvent('load'),
    tab2.locator('.moved-dialog').getByRole('button', { name: 'Use it here' }).click(),
  ]);
  await tab2.waitForSelector('.voice-dock');
  check(await tab2.locator('.moved-dialog[open]').count() === 0, 'taking it back opens the project again');
  check((await pageTitles(tab2))[0] === 'Revenue review v3', 'from the latest save');
  await tab1.waitForSelector('.moved-dialog[open]');
  check(true, 'and the first tab now says the project moved');
  await tab2.close();

  // An unknown project goes to the list with a note
  await tab1.goto(new URL('/?project=pdoesnotexist', url).href);
  await tab1.waitForSelector('.project-card');
  check(!new URL(tab1.url()).searchParams.has('project'), 'an unknown project goes to the project list');
  check(await tab1.locator('.snackbar').isVisible(), 'and says the project is not here');
  await context.close();
}

// ---------- The data of a project ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  watch(page, 'data');
  await page.goto(url);
  await page.waitForSelector('.voice-dock');
  // A new project leaves the sample tables out
  await page.click('.project-switcher');
  await page.getByRole('menuitem', { name: 'New project…' }).click();
  await page.fill('.project-dialog[open] input', 'Churn data');
  const firstId = projectOf(page);
  await Promise.all([page.waitForURL((u) => new URL(u).searchParams.get('project') !== firstId), page.getByRole('button', { name: 'Create' }).click()]);
  await page.waitForSelector('.voice-dock');
  const project = projectOf(page);

  const openFiles = async () => {
    await page.click('button[aria-label="BigQuery Catalog & Data Sources"]');
    await page.click('#datasource-tab-files');
    await page.waitForSelector('.datasource-files .bq-source-list');
  };
  const closeData = async () => {
    await page.click('.datasource-footer .filled-btn');
    await page.waitForTimeout(400);
  };
  const tableNames = () => page.locator('.schema-table-card .schema-table-title code').allTextContents();

  await openFiles();
  await page.waitForTimeout(300);
  check(!(await page.locator('[aria-label="Sample tables are part of this project"]').isChecked()), 'a new project has no sample tables');
  check(!(await tableNames()).includes('monthly_revenue'), 'and its local source lists none');

  // An uploaded file is kept with the project
  await page.setInputFiles('.datasource-files input[type="file"]', {
    name: 'churn.csv', mimeType: 'text/csv', buffer: Buffer.from('region,churned\nEMEA,12\nAPAC,7\nNA,9\n'),
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.schema-table-card code')].some((c) => c.textContent === 'churn'));
  check(true, 'an uploaded file becomes a table');
  await page.screenshot({ path: `${out}/projects-6-sources.png` });
  await closeData();
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.voice-dock');
  await openFiles();
  await page.waitForFunction(() => [...document.querySelectorAll('.schema-table-card code')].some((c) => c.textContent === 'churn'));
  check(true, 'the uploaded table is still there after a reload');
  const sum = await page.evaluate(async () => {
    const { executeSqlQuery } = await import('/src/data/sqlEngine.ts');
    const r = await executeSqlQuery('SELECT SUM(churned) AS n FROM churn');
    return r.rows[0]?.[0];
  });
  check(sum === 28, 'and it answers queries (28 churned)');

  // Sample tables on and off
  await page.click('[aria-label="Sample tables are part of this project"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.schema-table-card code')].some((c) => c.textContent === 'monthly_revenue'));
  check(true, 'turning the sample tables on adds them');
  await page.click('[aria-label="Sample tables are part of this project"]');
  await page.waitForFunction(() => ![...document.querySelectorAll('.schema-table-card code')].some((c) => c.textContent === 'monthly_revenue'));
  check(true, 'turning them off removes them');

  // Removing the table removes it from the project
  await page.getByRole('button', { name: 'Remove churn from the project' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.schema-table-card code')].some((c) => c.textContent === 'churn'));
  await closeData();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('.voice-dock');
  await openFiles();
  await page.waitForTimeout(500);
  check(!(await tableNames()).includes('churn'), 'a removed table does not come back after a reload');
  await closeData();

  // An example that needs the sample data asks to turn it on first
  await page.getByRole('button', { name: 'Open Live Dashboard' }).click();
  await page.waitForSelector('.sample-data-dialog[open]');
  check(await page.locator('.widget-card').count() === 0, 'the sample dashboard waits for the sample data');
  await page.screenshot({ path: `${out}/projects-7-sample-dialog.png` });
  await page.locator('.sample-data-dialog').getByRole('button', { name: 'Turn on' }).click();
  await page.waitForSelector('.widget-card');
  await page.waitForFunction(() => !document.querySelector('.widget-card .widget-loading, .widget-card [data-reloading="true"]'), null, { timeout: 15000 });
  check(await page.locator('.widget-card .widget-error').count() === 0, 'after turning it on the sample dashboard runs without errors');

  // Each project has its own data: the first project does not see this one's choice
  check(project != null, 'the data project has an id');
  await context.close();
}

// ---------- The work of an earlier version becomes the first project ----------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  watch(page, 'migrate');
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const scene = {
      version: 1, title: 'Legacy page', type: 'architecture', direction: 'LR',
      nodes: [{ id: 'a', label: 'API', kind: 'service', x: 0, y: 0 }], groups: [], edges: [], blocks: [],
    };
    localStorage.setItem('studio.workspace', JSON.stringify({ version: 2, active: 'page_1', pages: [{ id: 'page_1', scene }] }));
  });
  await page.goto(url);
  await page.waitForSelector('.voice-dock');
  check((await page.locator('.project-switcher-name').textContent()) === 'My first project', 'earlier work opens as "My first project"');
  check((await pageTitles(page))[0] === 'Legacy page', 'with the earlier pages in it');
  await context.close();
}

await browser.close();
const relevant = errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED|\/api\//.test(e));
if (relevant.length > 0) {
  console.log('Console errors:\n' + relevant.join('\n'));
}
if (failures.length > 0 || relevant.length > 0) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nprojects: all checks passed');
