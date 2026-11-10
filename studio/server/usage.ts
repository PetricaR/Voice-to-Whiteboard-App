/**
 * Accounts, daily allowances, cloud workspaces, shared diagrams, and telemetry
 * for signed-in users. Every Live API token is one "session" (a token starts
 * one connection of at most 30 minutes, and a resumed conversation fetches a
 * new one), so counting tokens bounds what a user, and the studio as a whole,
 * can spend of the Gemini API key per day.
 *
 * Counters, user profiles, cloud workspaces, and shares are kept in Firestore
 * on a deployment (shared by every Cloud Run instance, unaffected by restarts)
 * and in memory locally and in tests.
 */
import type { User } from './auth.ts';

export type Plan = 'free' | 'pro' | 'owner';

export interface Account {
  email: string;
  name?: string;
  picture?: string;
  plan: Plan;
  /** Sessions started today (UTC). */
  used: number;
  /** Sessions allowed per day; null when unlimited. */
  limit: number | null;
}

export interface BillingInfo {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
  billingPeriod?: 'monthly' | 'annual';
  currentPeriodEnd?: string;
}

export interface CloudWorkspace {
  version: number;
  activeId: string;
  pages: unknown[];
  library?: unknown[];
  updatedAt: string;
}

export interface SharedDiagramRecord {
  id: string;
  title: string;
  spec: unknown;
  authorName?: string;
  userId?: string;
  createdAt: string;
}

export type TelemetryKind =
  | 'session_start'
  | 'session_end'
  | 'tool_call'
  | 'undo'
  | 'redo'
  | 'client_error'
  | 'voice_error'
  | 'export'
  | 'import'
  | 'share';

export const TELEMETRY_KINDS: readonly TelemetryKind[] = [
  'session_start',
  'session_end',
  'tool_call',
  'undo',
  'redo',
  'client_error',
  'voice_error',
  'export',
  'import',
  'share',
];

export interface TelemetryEvent {
  kind: TelemetryKind;
  timestamp?: string;
  userId?: string;
  sessionId?: string;
  toolName?: string;
  diagramType?: string;
  errorCode?: string;
  message?: string;
  durationMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface TelemetrySummary {
  totalEvents: number;
  sessionsStarted: number;
  toolCalls: number;
  undos: number;
  redos: number;
  /** undo / max(1, toolCalls) — measures how often users undo agent/canvas edits. */
  undoRate: number;
  clientErrors: number;
  voiceErrors: number;
  exports: number;
  imports: number;
  shares: number;
  recentErrors: Array<{ kind: string; errorCode?: string; message?: string; timestamp: string }>;
}

export interface Limits {
  free: number;
  pro: number;
  /** Every user together, so a flood of new accounts cannot drain the key. */
  total: number;
}

export const DEFAULT_LIMITS: Limits = { free: 20, pro: 300, total: 1500 };

export interface UsageStore {
  /** Adds one to `key` if it is below `limit` (atomically); `used` is the count afterwards, or the current one when refused. */
  take(key: string, limit: number): Promise<{ ok: boolean; used: number }>;
  /** Gives one back (the token could not be issued). */
  give(key: string): Promise<void>;
  peek(key: string): Promise<number>;
  /** Records a sign-in; returns the stored plan (Stripe, or an admin, sets it to 'pro'). */
  upsertUser(user: User): Promise<Plan>;
  planOf(userId: string): Promise<Plan>;
  /** Updates a user's plan and optional Stripe billing details. */
  setUserPlan?(userId: string, plan: Plan, billing?: BillingInfo): Promise<void>;
  /** Finds a user by Stripe customer ID (or fallback email) and updates their plan. */
  setPlanByCustomer?(customerId: string, plan: Plan, billing?: BillingInfo, email?: string): Promise<string | null>;
  billingOf?(userId: string): Promise<BillingInfo | null>;
  /** Cloud save: stores and retrieves a signed-in user's diagram workspace. */
  saveWorkspace?(userId: string, workspace: CloudWorkspace): Promise<void>;
  loadWorkspace?(userId: string): Promise<CloudWorkspace | null>;
  /** GDPR / account deletion: removes user profile, workspace, and today's counter. */
  deleteUser?(userId: string): Promise<void>;
  /** Read-only share links. */
  saveShare?(share: SharedDiagramRecord): Promise<void>;
  loadShare?(id: string): Promise<SharedDiagramRecord | null>;
  /** Error monitoring & usage telemetry (including undo rate). */
  recordTelemetry?(event: TelemetryEvent): Promise<void>;
  telemetrySummary?(): Promise<TelemetrySummary>;
}

export function utcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export class Usage {
  private owners: Set<string>;

  constructor(
    readonly store: UsageStore,
    readonly limits: Limits = DEFAULT_LIMITS,
    ownerEmails: readonly string[] = [],
    private now: () => number = Date.now,
  ) {
    this.owners = new Set(ownerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  }

  private async plan(user: User): Promise<Plan> {
    if (this.owners.has(user.email.toLowerCase())) return 'owner';
    return this.store.planOf(user.id);
  }

  private limitOf(plan: Plan): number | null {
    return plan === 'owner' ? null : plan === 'pro' ? this.limits.pro : this.limits.free;
  }

  async signIn(user: User): Promise<Account> {
    const stored = await this.store.upsertUser(user);
    const plan = this.owners.has(user.email.toLowerCase()) ? 'owner' : stored;
    return this.describe(user, plan);
  }

  async account(user: User): Promise<Account> {
    return this.describe(user, await this.plan(user));
  }

  private async describe(user: User, plan: Plan): Promise<Account> {
    const used = await this.store.peek(`${utcDay(this.now())}:${user.id}`);
    return { email: user.email, name: user.name, picture: user.picture, plan, used, limit: this.limitOf(plan) };
  }

  /**
   * Reserves one session for `user`. On success, `release` gives it back if the
   * token cannot be issued after all.
   */
  async reserve(user: User): Promise<
    | { ok: true; account: Account; release: () => Promise<void> }
    | { ok: false; reason: 'user' | 'total'; account: Account }
  > {
    const day = utcDay(this.now());
    const plan = await this.plan(user);
    const limit = this.limitOf(plan);
    const mineKey = `${day}:${user.id}`;
    const totalKey = `${day}:_total`;
    const mine = await this.store.take(mineKey, limit ?? Number.MAX_SAFE_INTEGER);
    const account: Account = { email: user.email, name: user.name, picture: user.picture, plan, used: mine.used, limit };
    if (!mine.ok) return { ok: false, reason: 'user', account };
    const total = await this.store.take(totalKey, this.limits.total);
    if (!total.ok) {
      await this.store.give(mineKey);
      return { ok: false, reason: 'total', account: { ...account, used: mine.used - 1 } };
    }
    return {
      ok: true,
      account,
      release: async () => {
        await Promise.all([this.store.give(mineKey), this.store.give(totalKey)]);
      },
    };
  }

  async setUserPlan(userId: string, plan: Plan, billing?: BillingInfo): Promise<void> {
    await this.store.setUserPlan?.(userId, plan, billing);
  }

  async setPlanByCustomer(customerId: string, plan: Plan, billing?: BillingInfo, email?: string): Promise<string | null> {
    return (await this.store.setPlanByCustomer?.(customerId, plan, billing, email)) ?? null;
  }

  async billingOf(userId: string): Promise<BillingInfo | null> {
    return (await this.store.billingOf?.(userId)) ?? null;
  }

  async saveWorkspace(userId: string, workspace: CloudWorkspace): Promise<void> {
    await this.store.saveWorkspace?.(userId, workspace);
  }

  async loadWorkspace(userId: string): Promise<CloudWorkspace | null> {
    return (await this.store.loadWorkspace?.(userId)) ?? null;
  }

  async deleteUser(userId: string): Promise<void> {
    await this.store.deleteUser?.(userId);
  }

  async saveShare(share: SharedDiagramRecord): Promise<void> {
    await this.store.saveShare?.(share);
  }

  async loadShare(id: string): Promise<SharedDiagramRecord | null> {
    return (await this.store.loadShare?.(id)) ?? null;
  }

  async recordTelemetry(event: TelemetryEvent): Promise<void> {
    await this.store.recordTelemetry?.({
      ...event,
      timestamp: event.timestamp ?? new Date(this.now()).toISOString(),
    });
  }

  async telemetrySummary(): Promise<TelemetrySummary> {
    if (this.store.telemetrySummary) return this.store.telemetrySummary();
    return emptyTelemetrySummary();
  }
}

export function emptyTelemetrySummary(): TelemetrySummary {
  return {
    totalEvents: 0,
    sessionsStarted: 0,
    toolCalls: 0,
    undos: 0,
    redos: 0,
    undoRate: 0,
    clientErrors: 0,
    voiceErrors: 0,
    exports: 0,
    imports: 0,
    shares: 0,
    recentErrors: [],
  };
}

export function summarizeTelemetryEvents(events: readonly TelemetryEvent[]): TelemetrySummary {
  let sessionsStarted = 0;
  let toolCalls = 0;
  let undos = 0;
  let redos = 0;
  let clientErrors = 0;
  let voiceErrors = 0;
  let exports = 0;
  let imports = 0;
  let shares = 0;
  const recentErrors: Array<{ kind: string; errorCode?: string; message?: string; timestamp: string }> = [];

  for (const ev of events) {
    switch (ev.kind) {
      case 'session_start':
        sessionsStarted++;
        break;
      case 'tool_call':
        toolCalls++;
        break;
      case 'undo':
        undos++;
        break;
      case 'redo':
        redos++;
        break;
      case 'client_error':
        clientErrors++;
        recentErrors.push({
          kind: ev.kind,
          errorCode: ev.errorCode,
          message: ev.message,
          timestamp: ev.timestamp ?? new Date().toISOString(),
        });
        break;
      case 'voice_error':
        voiceErrors++;
        recentErrors.push({
          kind: ev.kind,
          errorCode: ev.errorCode,
          message: ev.message,
          timestamp: ev.timestamp ?? new Date().toISOString(),
        });
        break;
      case 'export':
        exports++;
        break;
      case 'import':
        imports++;
        break;
      case 'share':
        shares++;
        break;
    }
  }

  const undoRate = toolCalls > 0 ? Number((undos / toolCalls).toFixed(4)) : 0;
  return {
    totalEvents: events.length,
    sessionsStarted,
    toolCalls,
    undos,
    redos,
    undoRate,
    clientErrors,
    voiceErrors,
    exports,
    imports,
    shares,
    recentErrors: recentErrors.slice(-20).reverse(),
  };
}

export class MemoryUsageStore implements UsageStore {
  private counts = new Map<string, number>();
  private plans = new Map<string, Plan>();
  private users = new Map<string, User>();
  private billing = new Map<string, BillingInfo>();
  private customerToUser = new Map<string, string>();
  private workspaces = new Map<string, CloudWorkspace>();
  private shares = new Map<string, SharedDiagramRecord>();
  private telemetry: TelemetryEvent[] = [];

  async take(key: string, limit: number) {
    const used = this.counts.get(key) ?? 0;
    if (used >= limit) return { ok: false, used };
    this.counts.set(key, used + 1);
    if (this.counts.size > 10_000) this.counts.delete(this.counts.keys().next().value as string);
    return { ok: true, used: used + 1 };
  }

  async give(key: string) {
    const used = this.counts.get(key) ?? 0;
    if (used > 0) this.counts.set(key, used - 1);
  }

  async peek(key: string) {
    return this.counts.get(key) ?? 0;
  }

  async upsertUser(user: User) {
    this.users.set(user.id, user);
    if (!this.plans.has(user.id)) this.plans.set(user.id, 'free');
    return this.plans.get(user.id) ?? 'free';
  }

  async planOf(userId: string) {
    return this.plans.get(userId) ?? 'free';
  }

  /** Tests and admin tools. */
  setPlan(userId: string, plan: Plan) {
    this.plans.set(userId, plan);
  }

  async setUserPlan(userId: string, plan: Plan, billing?: BillingInfo) {
    this.plans.set(userId, plan);
    if (billing) {
      const merged = { ...(this.billing.get(userId) ?? {}), ...billing };
      this.billing.set(userId, merged);
      if (merged.stripeCustomerId) {
        this.customerToUser.set(merged.stripeCustomerId, userId);
      }
    }
  }

  async setPlanByCustomer(customerId: string, plan: Plan, billing?: BillingInfo, email?: string): Promise<string | null> {
    let userId = this.customerToUser.get(customerId) ?? null;
    if (!userId && email) {
      const lower = email.toLowerCase();
      for (const [id, u] of this.users.entries()) {
        if (u.email.toLowerCase() === lower) {
          userId = id;
          break;
        }
      }
    }
    if (!userId) return null;
    await this.setUserPlan(userId, plan, { ...billing, stripeCustomerId: customerId });
    return userId;
  }

  async billingOf(userId: string): Promise<BillingInfo | null> {
    return this.billing.get(userId) ?? null;
  }

  async saveWorkspace(userId: string, workspace: CloudWorkspace): Promise<void> {
    this.workspaces.set(userId, workspace);
  }

  async loadWorkspace(userId: string): Promise<CloudWorkspace | null> {
    return this.workspaces.get(userId) ?? null;
  }

  async deleteUser(userId: string): Promise<void> {
    const info = this.billing.get(userId);
    if (info?.stripeCustomerId) this.customerToUser.delete(info.stripeCustomerId);
    this.users.delete(userId);
    this.plans.delete(userId);
    this.billing.delete(userId);
    this.workspaces.delete(userId);
    for (const key of this.counts.keys()) {
      if (key.endsWith(`:${userId}`)) this.counts.delete(key);
    }
  }

  async saveShare(share: SharedDiagramRecord): Promise<void> {
    this.shares.set(share.id, share);
    if (this.shares.size > 5_000) {
      this.shares.delete(this.shares.keys().next().value as string);
    }
  }

  async loadShare(id: string): Promise<SharedDiagramRecord | null> {
    return this.shares.get(id) ?? null;
  }

  async recordTelemetry(event: TelemetryEvent): Promise<void> {
    this.telemetry.push(event);
    if (this.telemetry.length > 5_000) {
      this.telemetry.shift();
    }
  }

  async telemetrySummary(): Promise<TelemetrySummary> {
    return summarizeTelemetryEvents(this.telemetry);
  }
}

const USERS = 'studio_users';
const USAGE = 'studio_usage';
const WORKSPACES = 'studio_workspaces';
const SHARES = 'studio_shares';
const TELEMETRY = 'studio_telemetry';

/**
 * Firestore (Native mode) on Cloud Run, with the service account's credentials.
 * `studio_usage/{day}:{userId}` holds { count, expireAt }; a TTL policy on
 * `expireAt` deletes old days. `studio_users/{userId}` holds the profile, plan,
 * and Stripe billing details. `studio_workspaces/{userId}` holds cloud-saved
 * diagrams. `studio_shares/{shareId}` holds read-only shared diagrams.
 */
export async function createFirestoreUsageStore(projectId?: string, databaseId?: string): Promise<UsageStore> {
  const { Firestore, FieldValue, Timestamp } = await import('@google-cloud/firestore');
  const db = new Firestore({ projectId, databaseId, ignoreUndefinedProperties: true });
  const counter = (key: string) => db.collection(USAGE).doc(key);
  const expireAt = (key: string) => Timestamp.fromMillis(Date.parse(key.slice(0, 10)) + 8 * 24 * 3600_000);
  const recentEvents: TelemetryEvent[] = [];

  return {
    take: (key, limit) => db.runTransaction(async (tx) => {
      const ref = counter(key);
      const snap = await tx.get(ref);
      const used = Number(snap.get('count') ?? 0);
      if (used >= limit) return { ok: false, used };
      tx.set(ref, { count: used + 1, expireAt: expireAt(key), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ok: true, used: used + 1 };
    }),

    async give(key) {
      await db.runTransaction(async (tx) => {
        const ref = counter(key);
        const snap = await tx.get(ref);
        const used = Number(snap.get('count') ?? 0);
        if (used > 0) tx.set(ref, { count: used - 1 }, { merge: true });
      });
    },

    async peek(key) {
      const snap = await counter(key).get();
      return Number(snap.get('count') ?? 0);
    },

    async upsertUser(user) {
      const ref = db.collection(USERS).doc(user.id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const plan = (snap.get('plan') as Plan | undefined) ?? 'free';
        tx.set(ref, {
          email: user.email,
          name: user.name,
          picture: user.picture,
          plan,
          lastSignInAt: FieldValue.serverTimestamp(),
          ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        }, { merge: true });
        return plan === 'pro' ? 'pro' : 'free';
      });
    },

    async planOf(userId) {
      const snap = await db.collection(USERS).doc(userId).get();
      return snap.get('plan') === 'pro' ? 'pro' : 'free';
    },

    async setUserPlan(userId, plan, billing) {
      await db.collection(USERS).doc(userId).set({
        plan,
        ...(billing ? { billing } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    },

    async setPlanByCustomer(customerId, plan, billing, email) {
      const byCustomer = await db.collection(USERS)
        .where('billing.stripeCustomerId', '==', customerId)
        .limit(1)
        .get();
      let doc = byCustomer.docs[0];
      if (!doc && email) {
        const byEmail = await db.collection(USERS)
          .where('email', '==', email)
          .limit(1)
          .get();
        doc = byEmail.docs[0];
      }
      if (!doc) return null;
      await doc.ref.set({
        plan,
        billing: { ...((doc.get('billing') as BillingInfo | undefined) ?? {}), ...billing, stripeCustomerId: customerId },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return doc.id;
    },

    async billingOf(userId) {
      const snap = await db.collection(USERS).doc(userId).get();
      return (snap.get('billing') as BillingInfo | undefined) ?? null;
    },

    async saveWorkspace(userId, workspace) {
      await db.collection(WORKSPACES).doc(userId).set({
        ...workspace,
        updatedAtServer: FieldValue.serverTimestamp(),
      });
    },

    async loadWorkspace(userId) {
      const snap = await db.collection(WORKSPACES).doc(userId).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data || !Array.isArray(data.pages)) return null;
      return {
        version: Number(data.version ?? 1),
        activeId: String(data.activeId ?? ''),
        pages: data.pages,
        library: Array.isArray(data.library) ? data.library : [],
        updatedAt: String(data.updatedAt ?? new Date().toISOString()),
      };
    },

    async deleteUser(userId) {
      const day = utcDay(Date.now());
      await Promise.all([
        db.collection(USERS).doc(userId).delete(),
        db.collection(WORKSPACES).doc(userId).delete(),
        db.collection(USAGE).doc(`${day}:${userId}`).delete(),
      ]);
    },

    async saveShare(share) {
      await db.collection(SHARES).doc(share.id).set({
        ...share,
        createdAtServer: FieldValue.serverTimestamp(),
      });
    },

    async loadShare(id) {
      const snap = await db.collection(SHARES).doc(id).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data || !data.spec) return null;
      return {
        id: snap.id,
        title: String(data.title ?? 'Shared Diagram'),
        spec: data.spec,
        authorName: data.authorName ? String(data.authorName) : undefined,
        userId: data.userId ? String(data.userId) : undefined,
        createdAt: String(data.createdAt ?? new Date().toISOString()),
      };
    },

    async recordTelemetry(event) {
      recentEvents.push(event);
      if (recentEvents.length > 2_000) recentEvents.shift();
      await db.collection(TELEMETRY).add({
        ...event,
        expireAt: Timestamp.fromMillis(Date.now() + 30 * 24 * 3600_000),
        createdAt: FieldValue.serverTimestamp(),
      }).catch(() => undefined);
    },

    async telemetrySummary() {
      return summarizeTelemetryEvents(recentEvents);
    },
  };
}
