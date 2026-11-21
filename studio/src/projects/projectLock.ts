/**
 * One tab per project. A tab that opens a project holds its lock (Web Locks
 * API) until it closes, so two tabs never edit — and overwrite — the same
 * project. Another tab can ask for the project: the owner saves, stops and
 * lets go (BroadcastChannel), or, when it does not answer in time (a frozen
 * tab), the lock is taken from it.
 *
 * The browser releases a lock when its tab closes, reloads or crashes.
 */

export type LostReason = 'handed-off' | 'taken';

export interface ProjectLock {
  readonly projectId: string;
  /** True while this tab owns the project. */
  readonly held: boolean;
  /**
   * Runs when another tab asks for the project, before the lock is let go:
   * the place to save and stop. Returns the unsubscribe.
   */
  onHandoffRequest(handler: () => Promise<void> | void): () => void;
  /** Runs once when this tab no longer owns the project. Returns the unsubscribe. */
  onLost(listener: (reason: LostReason) => void): () => void;
  /** Lets go of the project (no lost listeners run). */
  release(): void;
}

interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void;
  close(): void;
}

export interface LockDeps {
  /** Null where the browser has no Web Locks: every tab then works without a lock, as before. */
  locks?: LockManager | null;
  channel?: ((name: string) => ChannelLike) | null;
  /** How long the owner has to save and let go before the lock is taken. */
  handoffTimeoutMs?: number;
}

const PREFIX = 'studio:project:';
const HANDOFF = 'handoff-request';
export const HANDOFF_TIMEOUT_MS = 3000;

export function lockName(projectId: string): string {
  return PREFIX + projectId;
}

function resolveDeps(deps: LockDeps = {}): Required<LockDeps> {
  return {
    locks: deps.locks !== undefined ? deps.locks : (globalThis.navigator?.locks ?? null),
    channel: deps.channel !== undefined
      ? deps.channel
      : (typeof BroadcastChannel !== 'undefined' ? (name: string) => new BroadcastChannel(name) : null),
    handoffTimeoutMs: deps.handoffTimeoutMs ?? HANDOFF_TIMEOUT_MS,
  };
}

class HeldLock implements ProjectLock {
  held = true;
  /** Resolving it ends the lock callback, which releases the lock. */
  readonly done: Promise<void>;
  private letGo!: () => void;
  private handoffHandlers = new Set<() => Promise<void> | void>();
  private lostListeners = new Set<(reason: LostReason) => void>();
  private channel: ChannelLike | null;
  private handingOff = false;

  constructor(readonly projectId: string, channel: Required<LockDeps>['channel']) {
    this.done = new Promise((resolve) => {
      this.letGo = resolve;
    });
    this.channel = channel?.(lockName(projectId)) ?? null;
    this.channel?.addEventListener('message', (e) => {
      if ((e.data as { type?: unknown } | null)?.type === HANDOFF) void this.handOff();
    });
  }

  onHandoffRequest(handler: () => Promise<void> | void): () => void {
    this.handoffHandlers.add(handler);
    return () => this.handoffHandlers.delete(handler);
  }

  onLost(listener: (reason: LostReason) => void): () => void {
    this.lostListeners.add(listener);
    return () => this.lostListeners.delete(listener);
  }

  private async handOff() {
    if (!this.held || this.handingOff) return;
    this.handingOff = true;
    for (const handler of [...this.handoffHandlers]) {
      try {
        await handler();
      } catch {
        // let go anyway: the other tab takes the lock after its timeout otherwise
      }
    }
    this.lose('handed-off');
  }

  /** This tab no longer owns the project. */
  lose(reason: LostReason) {
    if (!this.held) return;
    this.end();
    for (const listener of [...this.lostListeners]) listener(reason);
  }

  release() {
    if (this.held) this.end();
  }

  private end() {
    this.held = false;
    this.channel?.close();
    this.letGo();
  }
}

/** Where the browser has no Web Locks: always owned, never lost. */
class UnlockedProject implements ProjectLock {
  held = true;
  constructor(readonly projectId: string) {}
  onHandoffRequest() {
    return () => undefined;
  }
  onLost() {
    return () => undefined;
  }
  release() {
    this.held = false;
  }
}

/** Resolves with the lock once held, or null when `ifAvailable` and another tab has it. */
function request(projectId: string, deps: Required<LockDeps>, options: LockOptions): Promise<HeldLock | null> {
  const locks = deps.locks!;
  return new Promise((resolve, reject) => {
    let handle: HeldLock | null = null;
    locks.request(lockName(projectId), options, async (lock) => {
      if (lock == null) {
        resolve(null);
        return;
      }
      handle = new HeldLock(projectId, deps.channel);
      resolve(handle);
      await handle.done;
    }).catch((e: unknown) => {
      // Once held, a rejection means another tab took the lock (steal)
      if (handle != null) handle.lose('taken');
      else reject(e);
    });
  });
}

/** The project's lock, or null when it is open in another tab. */
export async function tryLockProject(projectId: string, deps?: LockDeps): Promise<ProjectLock | null> {
  const d = resolveDeps(deps);
  if (d.locks == null) return new UnlockedProject(projectId);
  return request(projectId, d, { ifAvailable: true });
}

/**
 * Takes the project from the tab that has it: asks it to save and let go,
 * and takes the lock anyway when it does not answer in time.
 */
export async function takeOverProject(projectId: string, deps?: LockDeps): Promise<ProjectLock> {
  const d = resolveDeps(deps);
  if (d.locks == null) return new UnlockedProject(projectId);
  const channel = d.channel?.(lockName(projectId)) ?? null;
  channel?.postMessage({ type: HANDOFF });
  channel?.close();
  try {
    const lock = await request(projectId, d, { signal: AbortSignal.timeout(d.handoffTimeoutMs) });
    if (lock != null) return lock;
  } catch {
    // the owner did not let go in time
  }
  const stolen = await request(projectId, d, { steal: true });
  if (stolen == null) throw new Error('The project could not be taken over.');
  return stolen;
}

/** Ids of the projects some tab holds now (from a tab that holds none, the ones open elsewhere). */
export async function lockedProjects(deps?: LockDeps): Promise<Set<string>> {
  const d = resolveDeps(deps);
  if (d.locks == null) return new Set();
  try {
    const snapshot = await d.locks.query();
    return new Set((snapshot.held ?? [])
      .map((l) => l.name ?? '')
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => name.slice(PREFIX.length)));
  } catch {
    return new Set();
  }
}
