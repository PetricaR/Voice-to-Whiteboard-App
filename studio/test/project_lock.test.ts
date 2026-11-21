import { afterEach, describe, expect, it } from 'vitest';
import { lockedProjects, takeOverProject, tryLockProject, type LostReason, type ProjectLock } from '../src/projects/projectLock';

// Node has the Web Locks API and BroadcastChannel, like the browser
const held: ProjectLock[] = [];
let n = 0;
/** A fresh project id per test, so tests never share a lock. */
const newId = () => `ptest${Date.now().toString(36)}${n++}`;
async function lock(id: string, deps?: Parameters<typeof tryLockProject>[1]) {
  const l = await tryLockProject(id, deps);
  if (l) held.push(l);
  return l;
}
afterEach(() => {
  for (const l of held.splice(0)) l.release();
});

describe('project lock', () => {
  it('lets one tab own a project and tells the others it is open', async () => {
    const id = newId();
    const first = await lock(id);
    expect(first?.held).toBe(true);
    expect(await lock(id)).toBeNull();
    expect((await lockedProjects()).has(id)).toBe(true);

    first!.release();
    // The browser lets go once the lock callback has settled
    await new Promise((r) => setTimeout(r, 0));
    expect((await lockedProjects()).has(id)).toBe(false);
    expect((await lock(id))?.held).toBe(true);
  });

  it('hands the project over: the owner saves first, then lets go', async () => {
    const id = newId();
    const owner = (await lock(id))!;
    const events: string[] = [];
    owner.onHandoffRequest(async () => {
      await new Promise((r) => setTimeout(r, 30));
      events.push('saved');
    });
    owner.onLost((reason: LostReason) => events.push(`lost:${reason}`));

    const taker = await takeOverProject(id);
    held.push(taker);
    events.push('taken');
    expect(events).toEqual(['saved', 'lost:handed-off', 'taken']);
    expect(owner.held).toBe(false);
    expect(taker.held).toBe(true);
    expect(await lock(id)).toBeNull();
  });

  it('takes the project from an owner that does not answer', async () => {
    const id = newId();
    // An owner that never hears the request (e.g. a frozen tab)
    const owner = (await lock(id, { channel: null }))!;
    const lost: LostReason[] = [];
    owner.onLost((r) => lost.push(r));

    const started = Date.now();
    const taker = await takeOverProject(id, { handoffTimeoutMs: 100 });
    held.push(taker);
    expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    expect(taker.held).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(lost).toEqual(['taken']);
    expect(owner.held).toBe(false);
  });

  it('works without Web Locks, as before', async () => {
    const id = newId();
    const a = await tryLockProject(id, { locks: null });
    const b = await tryLockProject(id, { locks: null });
    expect(a?.held && b?.held).toBe(true);
    expect((await lockedProjects({ locks: null })).size).toBe(0);
  });
});
