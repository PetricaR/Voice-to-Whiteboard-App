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

  // Opening a card opens the project
  await Promise.all([tab1.waitForURL((u) => new URL(u).searchParams.get('project') === first), tab1.locator('.project-card-link', { hasText: 'My first project' }).click()]);
  await tab1.waitForSelector('.voice-dock');
  check((await pageTitles(tab1))[0] === 'Revenue review v2', 'a card opens its project');

  // An unknown project goes to the list with a note
  await tab1.goto(new URL('/?project=pdoesnotexist', url).href);
  await tab1.waitForSelector('.project-card');
  check(!new URL(tab1.url()).searchParams.has('project'), 'an unknown project goes to the project list');
  check(await tab1.locator('.snackbar').isVisible(), 'and says the project is not here');
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
