/**
 * Stripe billing integration for Voice Diagram Studio (modeled on Formare's
 * Stripe checkout, customer portal, and webhook lifecycle).
 *
 * Uses native `fetch` against `https://api.stripe.com/v1/*` and `node:crypto`
 * HMAC-SHA256 (`Stripe-Signature`) verification so the server remains
 * dependency-free and fully testable offline.
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY           sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET       whsec_...
 *   STRIPE_PRICE_ID_MONTHLY     optional price_... (falls back to inline €19/mo)
 *   STRIPE_PRICE_ID_ANNUAL      optional price_... (falls back to inline €180/yr)
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from './auth.ts';
import type { BillingInfo, Plan, Usage } from './usage.ts';

const STRIPE_API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SEC = 300; // 5 minutes

export type BillingPeriod = 'monthly' | 'annual';

export class StripeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface StripeOptions {
  secretKey: string;
  webhookSecret?: string;
  priceIdMonthly?: string;
  priceIdAnnual?: string;
  currency?: string;
  monthlyAmountCents?: number;
  annualAmountCents?: number;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface StripeService {
  readonly configured: boolean;
  readonly webhookConfigured: boolean;
  readonly pricing: {
    currency: string;
    monthlyCents: number;
    annualCents: number;
  };
  createCheckoutSession(params: {
    user: User;
    billingPeriod: BillingPeriod;
    origin: string;
    existingCustomerId?: string;
  }): Promise<{ sessionId: string; url: string }>;
  createPortalSession(params: {
    customerId: string;
    origin: string;
  }): Promise<{ url: string }>;
  handleWebhook(rawBody: string, signatureHeader: string | undefined, usage: Usage): Promise<{
    received: true;
    type: string;
    userId?: string | null;
    plan?: Plan;
  }>;
}

/** Encodes nested key-value pairs as `application/x-www-form-urlencoded` for Stripe's REST API. */
export function encodeForm(entries: Array<[string, string | number | boolean | undefined]>): string {
  const params = new URLSearchParams();
  for (const [k, v] of entries) {
    if (v !== undefined && v !== '') {
      params.append(k, String(v));
    }
  }
  return params.toString();
}

/**
 * Verifies a `Stripe-Signature` header (`t=...,v1=...`) against the raw request
 * payload using HMAC-SHA256 and constant-time comparison.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  webhookSecret: string,
  nowMs: number = Date.now(),
): void {
  if (!signatureHeader) {
    throw new StripeError(400, 'missing-signature', 'Missing Stripe-Signature header.');
  }
  const parts = signatureHeader.split(',').map((p) => p.trim());
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    if (k === 't') timestamp = v;
    if (k === 'v1' && v) signatures.push(v);
  }
  const tsNum = Number(timestamp);
  if (!timestamp || !Number.isFinite(tsNum) || signatures.length === 0) {
    throw new StripeError(400, 'invalid-signature', 'Malformed Stripe-Signature header.');
  }
  const ageSec = Math.abs(Math.floor(nowMs / 1000) - tsNum);
  if (ageSec > WEBHOOK_TOLERANCE_SEC) {
    throw new StripeError(400, 'signature-expired', 'Stripe webhook timestamp is outside the tolerance window.');
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedHex = createHmac('sha256', webhookSecret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const matched = signatures.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, 'hex');
      return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
  if (!matched) {
    throw new StripeError(400, 'invalid-signature', 'Stripe webhook signature verification failed.');
  }
}

export function createStripe(opts: StripeOptions): StripeService {
  const secretKey = opts.secretKey.trim();
  const webhookSecret = (opts.webhookSecret ?? '').trim();
  const currency = (opts.currency ?? 'eur').toLowerCase();
  const monthlyCents = opts.monthlyAmountCents ?? 1900; // €19.00 / month
  const annualCents = opts.annualAmountCents ?? 18000;  // €180.00 / year (€15/mo)
  const fetchFn = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;

  async function stripePost(path: string, formEntries: Array<[string, string | number | boolean | undefined]>): Promise<Record<string, unknown>> {
    if (!secretKey) {
      throw new StripeError(503, 'billing-not-configured', 'Stripe billing is not configured on this server.');
    }
    let res: Response;
    try {
      res = await fetchFn(`${STRIPE_API}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: encodeForm(formEntries),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new StripeError(502, 'stripe-unreachable', `Could not reach Stripe (${e instanceof Error ? e.message : String(e)}).`);
    }
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // non-JSON
    }
    if (!res.ok) {
      const errObj = data.error as { message?: unknown } | undefined;
      const detail = String(errObj?.message ?? text).slice(0, 240);
      throw new StripeError(502, 'stripe-error', `Stripe API error (${res.status}): ${detail}`);
    }
    return data;
  }

  return {
    configured: secretKey.length > 0,
    webhookConfigured: secretKey.length > 0 && webhookSecret.length > 0,
    pricing: {
      currency,
      monthlyCents,
      annualCents,
    },

    async createCheckoutSession({ user, billingPeriod, origin, existingCustomerId }) {
      const priceId = billingPeriod === 'annual' ? opts.priceIdAnnual : opts.priceIdMonthly;
      const interval = billingPeriod === 'annual' ? 'year' : 'month';
      const unitAmount = billingPeriod === 'annual' ? annualCents : monthlyCents;

      const entries: Array<[string, string | number | boolean | undefined]> = [
        ['mode', 'subscription'],
        ['payment_method_types[0]', 'card'],
        ['client_reference_id', user.id],
        ['allow_promotion_codes', true],
        ['billing_address_collection', 'required'],
        ['tax_id_collection[enabled]', true],
        ['success_url', `${origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`],
        ['cancel_url', `${origin}/?billing=cancelled`],
        ['metadata[userId]', user.id],
        ['metadata[email]', user.email],
        ['metadata[billingPeriod]', billingPeriod],
        ['subscription_data[metadata][userId]', user.id],
        ['subscription_data[metadata][email]', user.email],
        ['subscription_data[metadata][billingPeriod]', billingPeriod],
      ];

      if (existingCustomerId) {
        entries.push(['customer', existingCustomerId]);
      } else {
        entries.push(['customer_email', user.email]);
      }

      if (priceId) {
        entries.push(['line_items[0][price]', priceId]);
        entries.push(['line_items[0][quantity]', 1]);
      } else {
        entries.push(['line_items[0][quantity]', 1]);
        entries.push(['line_items[0][price_data][currency]', currency]);
        entries.push(['line_items[0][price_data][unit_amount]', unitAmount]);
        entries.push(['line_items[0][price_data][recurring][interval]', interval]);
        entries.push(['line_items[0][price_data][product_data][name]', `Voice Diagram Studio Pro (${billingPeriod === 'annual' ? 'Annual' : 'Monthly'})`]);
        entries.push(['line_items[0][price_data][product_data][description]', '300 daily voice sessions, cloud diagram sync, multi-cloud packs & sequence diagrams']);
      }

      const session = await stripePost('/checkout/sessions', entries);
      const sessionId = typeof session.id === 'string' ? session.id : '';
      const url = typeof session.url === 'string' ? session.url : '';
      if (!sessionId || !url) {
        throw new StripeError(502, 'stripe-error', 'Stripe did not return a checkout session URL.');
      }
      return { sessionId, url };
    },

    async createPortalSession({ customerId, origin }) {
      const session = await stripePost('/billing_portal/sessions', [
        ['customer', customerId],
        ['return_url', `${origin}/?billing=portal`],
      ]);
      const url = typeof session.url === 'string' ? session.url : '';
      if (!url) {
        throw new StripeError(502, 'stripe-error', 'Stripe did not return a customer portal URL.');
      }
      return { url };
    },

    async handleWebhook(rawBody, signatureHeader, usage) {
      if (!webhookSecret) {
        throw new StripeError(503, 'webhook-not-configured', 'STRIPE_WEBHOOK_SECRET is not configured.');
      }
      verifyStripeSignature(rawBody, signatureHeader, webhookSecret, now());

      let event: { type?: unknown; data?: { object?: Record<string, unknown> } };
      try {
        event = JSON.parse(rawBody);
      } catch {
        throw new StripeError(400, 'bad-json', 'Invalid webhook JSON payload.');
      }

      const type = typeof event.type === 'string' ? event.type : 'unknown';
      const obj = event.data?.object ?? {};
      const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
      const metaUserId = typeof metadata.userId === 'string' && metadata.userId
        ? metadata.userId
        : typeof obj.client_reference_id === 'string' && obj.client_reference_id
          ? obj.client_reference_id
          : undefined;
      const metaEmail = typeof metadata.email === 'string' && metadata.email
        ? metadata.email
        : typeof obj.customer_email === 'string' && obj.customer_email
          ? obj.customer_email
          : undefined;
      const billingPeriod: BillingPeriod | undefined =
        metadata.billingPeriod === 'annual' || metadata.billingPeriod === 'monthly'
          ? metadata.billingPeriod
          : undefined;
      const customerId = typeof obj.customer === 'string' ? obj.customer : undefined;

      if (type === 'checkout.session.completed') {
        const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : undefined;
        const billing: BillingInfo = {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: 'active',
          billingPeriod: billingPeriod ?? 'monthly',
        };
        if (metaUserId) {
          await usage.setUserPlan(metaUserId, 'pro', billing);
          return { received: true, type, userId: metaUserId, plan: 'pro' };
        }
        if (customerId) {
          const updatedId = await usage.setPlanByCustomer(customerId, 'pro', billing, metaEmail);
          return { received: true, type, userId: updatedId, plan: 'pro' };
        }
        return { received: true, type, userId: null };
      }

      if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
        const status = typeof obj.status === 'string' ? obj.status : 'active';
        const subscriptionId = typeof obj.id === 'string' ? obj.id : undefined;
        const periodEndSec = typeof obj.current_period_end === 'number' ? obj.current_period_end : undefined;
        const plan: Plan = status === 'active' || status === 'trialing' ? 'pro' : 'free';
        const billing: BillingInfo = {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: status,
          ...(billingPeriod ? { billingPeriod } : {}),
          ...(periodEndSec ? { currentPeriodEnd: new Date(periodEndSec * 1000).toISOString() } : {}),
        };
        if (metaUserId) {
          await usage.setUserPlan(metaUserId, plan, billing);
          return { received: true, type, userId: metaUserId, plan };
        }
        if (customerId) {
          const updatedId = await usage.setPlanByCustomer(customerId, plan, billing, metaEmail);
          return { received: true, type, userId: updatedId, plan };
        }
        return { received: true, type, userId: null };
      }

      if (type === 'customer.subscription.deleted') {
        const subscriptionId = typeof obj.id === 'string' ? obj.id : undefined;
        const billing: BillingInfo = {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: 'canceled',
        };
        if (metaUserId) {
          await usage.setUserPlan(metaUserId, 'free', billing);
          return { received: true, type, userId: metaUserId, plan: 'free' };
        }
        if (customerId) {
          const updatedId = await usage.setPlanByCustomer(customerId, 'free', billing, metaEmail);
          return { received: true, type, userId: updatedId, plan: 'free' };
        }
        return { received: true, type, userId: null };
      }

      if (type === 'invoice.payment_failed') {
        const billing: BillingInfo = {
          stripeCustomerId: customerId,
          subscriptionStatus: 'past_due',
        };
        if (metaUserId) {
          await usage.setUserPlan(metaUserId, 'free', billing);
          return { received: true, type, userId: metaUserId, plan: 'free' };
        }
        if (customerId) {
          const updatedId = await usage.setPlanByCustomer(customerId, 'free', billing, metaEmail);
          return { received: true, type, userId: updatedId, plan: 'free' };
        }
        return { received: true, type, userId: null };
      }

      return { received: true, type, userId: null };
    },
  };
}

export function stripeFromEnv(env: NodeJS.ProcessEnv, fetchFn?: typeof fetch, now?: () => number): StripeService | undefined {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? '';
  if (!secretKey) return undefined;
  return createStripe({
    secretKey,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceIdMonthly: env.STRIPE_PRICE_ID_MONTHLY,
    priceIdAnnual: env.STRIPE_PRICE_ID_ANNUAL,
    fetch: fetchFn,
    now,
  });
}
