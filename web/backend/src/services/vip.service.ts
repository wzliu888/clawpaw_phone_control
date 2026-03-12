import Stripe from 'stripe';
import pool from '../db/connection';
import { VipRepository, VipSubscription } from '../repositories/vip.repository';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY env var is required');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
if (!STRIPE_PRICE_ID) throw new Error('STRIPE_PRICE_ID env var is required');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });

export interface VipStatusResponse {
  status: 'trial' | 'active' | 'canceled' | 'expired' | 'none';
  trial_ends_at: string | null;
  current_period_end: string | null;
  days_left: number | null;
  trial_label: string | null;
}

export class VipService {
  private repo = new VipRepository();

  /** Called after anonymous registration — grants 1-hour free trial */
  async grantTrial(uid: string): Promise<void> {
    await this.repo.grantTrial(uid);
  }

  async getStatus(uid: string): Promise<VipStatusResponse> {
    const vip = await this.repo.findByUid(uid);
    if (!vip) {
      return {
        status: 'none',
        trial_ends_at: null,
        current_period_end: null,
        days_left: null,
        trial_label: null,
      };
    }

    // Auto-expire trial or active subscription if past end date
    const now = new Date();
    if (vip.status === 'trial' && vip.trial_ends_at && vip.trial_ends_at < now) {
      await pool.query('UPDATE vip_subscriptions SET status = ? WHERE uid = ?', ['expired', uid]);
      return {
        status: 'expired',
        trial_ends_at: vip.trial_ends_at.toISOString(),
        current_period_end: null,
        days_left: 0,
        trial_label: null,
      };
    }
    if (vip.status === 'active' && vip.current_period_end && vip.current_period_end < now) {
      await pool.query('UPDATE vip_subscriptions SET status = ? WHERE uid = ?', ['expired', uid]);
      return {
        status: 'expired',
        trial_ends_at: vip.trial_ends_at?.toISOString() ?? null,
        current_period_end: vip.current_period_end.toISOString(),
        days_left: 0,
        trial_label: null,
      };
    }

    const days_left = this.daysLeft(vip);
    const trial_label =
      vip.status === 'trial' && vip.trial_ends_at
        ? this.formatTrialLabel(vip.trial_ends_at, now)
        : null;
    return {
      status: vip.status,
      trial_ends_at: vip.trial_ends_at?.toISOString() ?? null,
      current_period_end: vip.current_period_end?.toISOString() ?? null,
      days_left,
      trial_label,
    };
  }

  /** Create a Stripe Checkout Session and return the URL */
  async createCheckoutSession(uid: string, returnUrl: string): Promise<string> {
    let vip = await this.repo.findByUid(uid);

    // Ensure trial row exists
    if (!vip) {
      await this.repo.grantTrial(uid);
      vip = await this.repo.findByUid(uid);
    }

    // Create or reuse Stripe customer
    let customerId = vip?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { uid } });
      customerId = customer.id;
      await this.repo.setStripeCustomer(uid, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICE_ID!, quantity: 1 }],
      mode: 'subscription',
      success_url: `${returnUrl}?vip=success`,
      cancel_url: `${returnUrl}?vip=cancel`,
      metadata: { uid },
    });

    return session.url!;
  }

  /** Handle incoming Stripe webhook events */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET env var is required');
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${err}`);
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // current_period_end lives on sub.items.data[0] in newer API versions
        const rawPeriodEnd = (sub as any).current_period_end as number | undefined;
        const periodEnd = rawPeriodEnd ? new Date(rawPeriodEnd * 1000) : new Date();
        if (sub.status === 'active') {
          await this.repo.activate(sub.id, sub.customer as string, periodEnd);
        } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
          await this.repo.cancel(sub.id);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await this.repo.cancel(sub.id);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as any).subscription as string | undefined;
        const customerId = (invoice as any).customer as string | undefined;
        if (subscriptionId && customerId && invoice.lines.data[0]?.period?.end) {
          const periodEnd = new Date(invoice.lines.data[0].period.end * 1000);
          // Use activate so that stripe_subscription_id is always written,
          // even if invoice.paid races ahead of customer.subscription.created
          await this.repo.activate(subscriptionId, customerId, periodEnd);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = (invoice as any).subscription as string | undefined;
        if (subscriptionId) {
          await this.repo.expire(subscriptionId);
        }
        break;
      }
    }
  }

  private daysLeft(vip: VipSubscription): number | null {
    const now = new Date();
    if (vip.status === 'trial' && vip.trial_ends_at) {
      return Math.max(0, Math.floor((vip.trial_ends_at.getTime() - now.getTime()) / 86400000));
    }
    if (vip.status === 'active' && vip.current_period_end) {
      return Math.max(0, Math.floor((vip.current_period_end.getTime() - now.getTime()) / 86400000));
    }
    return null;
  }

  private formatTrialLabel(trialEndsAt: Date, now: Date): string | null {
    const msLeft = trialEndsAt.getTime() - now.getTime();
    if (msLeft <= 0) return null;
    const totalSeconds = Math.floor(msLeft / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 1) {
      return 'Trial · <1 min left';
    }
    if (totalMinutes < 60) {
      return `Trial · ${totalMinutes} min left`;
    }
    const hours = Math.ceil(totalMinutes / 60);
    return `Trial · ${hours} h left`;
  }
}
