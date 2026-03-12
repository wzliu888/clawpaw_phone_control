CREATE TABLE IF NOT EXISTS vip_subscriptions (
  uid                    CHAR(36)     NOT NULL PRIMARY KEY,
  stripe_customer_id     VARCHAR(64)  DEFAULT NULL,
  stripe_subscription_id VARCHAR(64)  DEFAULT NULL,
  status                 ENUM('trial','active','canceled','expired') NOT NULL DEFAULT 'trial',
  trial_ends_at          DATETIME     DEFAULT NULL,
  current_period_end     DATETIME     DEFAULT NULL,
  created_at             DATETIME     NOT NULL DEFAULT NOW(),
  updated_at             DATETIME     NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  CONSTRAINT fk_vip_uid FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
);
