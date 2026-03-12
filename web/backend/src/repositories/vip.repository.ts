import pool from '../db/connection';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export type VipStatus = 'trial' | 'active' | 'canceled' | 'expired';

export interface VipSubscription {
  uid: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: VipStatus;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class VipRepository {
  async findByUid(uid: string): Promise<VipSubscription | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM vip_subscriptions WHERE uid = ? LIMIT 1',
      [uid]
    );
    return (rows[0] as VipSubscription) ?? null;
  }

  async findByStripeCustomer(customerId: string): Promise<VipSubscription | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM vip_subscriptions WHERE stripe_customer_id = ? LIMIT 1',
      [customerId]
    );
    return (rows[0] as VipSubscription) ?? null;
  }

  async findByStripeSubscription(subscriptionId: string): Promise<VipSubscription | null> {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM vip_subscriptions WHERE stripe_subscription_id = ? LIMIT 1',
      [subscriptionId]
    );
    return (rows[0] as VipSubscription) ?? null;
  }

  /** Grant 7-day trial on first registration. Uses INSERT IGNORE to be idempotent. */
  async grantTrial(uid: string): Promise<void> {
    await pool.query<ResultSetHeader>(
      `INSERT IGNORE INTO vip_subscriptions (uid, status, trial_ends_at)
       VALUES (?, 'trial', DATE_ADD(NOW(), INTERVAL 1 HOUR))`,
      [uid]
    );
  }

  async setStripeCustomer(uid: string, customerId: string): Promise<void> {
    await pool.query<ResultSetHeader>(
      'UPDATE vip_subscriptions SET stripe_customer_id = ? WHERE uid = ?',
      [customerId, uid]
    );
  }

  async activate(subscriptionId: string, customerId: string, periodEnd: Date): Promise<void> {
    await pool.query<ResultSetHeader>(
      `UPDATE vip_subscriptions
       SET stripe_subscription_id = ?, stripe_customer_id = ?, status = 'active', current_period_end = ?
       WHERE stripe_customer_id = ?`,
      [subscriptionId, customerId, periodEnd, customerId]
    );
  }

  async renewPeriod(subscriptionId: string, periodEnd: Date): Promise<void> {
    await pool.query<ResultSetHeader>(
      `UPDATE vip_subscriptions SET status = 'active', current_period_end = ? WHERE stripe_subscription_id = ?`,
      [periodEnd, subscriptionId]
    );
  }

  async cancel(subscriptionId: string): Promise<void> {
    await pool.query<ResultSetHeader>(
      `UPDATE vip_subscriptions SET status = 'canceled' WHERE stripe_subscription_id = ?`,
      [subscriptionId]
    );
  }

  async expire(subscriptionId: string): Promise<void> {
    await pool.query<ResultSetHeader>(
      `UPDATE vip_subscriptions SET status = 'expired' WHERE stripe_subscription_id = ?`,
      [subscriptionId]
    );
  }
}
