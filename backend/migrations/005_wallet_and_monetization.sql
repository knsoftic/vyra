-- 005 — Wallet, coin economy and monetization
--
-- Two rules are enforced structurally here:
--
--   ADR-013 — the ledger is the truth. Every movement is an immutable row carrying
--   the balance before and after. `wallets` holds derived balances for fast reads
--   and is reconciled against the ledger continuously.
--
--   ADR-018 — four balances that never merge. `wallet_ledger.wallet` is NOT NULL,
--   so no movement can be ambiguous about which balance it touched. Only
--   `live_gift` earnings ever mature into `withdrawable`.

CREATE TABLE wallets (
  user_id             BIGINT UNSIGNED NOT NULL,
  -- Purchased or converted. Spendable on promotion and gifting. Never payable.
  coin_balance        BIGINT NOT NULL DEFAULT 0,
  -- Earned from tasks/referrals. Converts one-way into coins. Never payable.
  reward_balance      BIGINT NOT NULL DEFAULT 0,
  -- Gift coins received while live. The only source that can become payable.
  live_gift_balance   BIGINT NOT NULL DEFAULT 0,
  -- Cleared portion of live_gift, in minor units of the payout currency.
  withdrawable_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  pending_reward      BIGINT NOT NULL DEFAULT 0,
  pending_withdrawal  DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_earned        BIGINT NOT NULL DEFAULT 0,
  is_frozen           TINYINT(1) NOT NULL DEFAULT 0,
  frozen_reason       VARCHAR(255) NULL,
  -- Set by the reconciliation job; a mismatch against the ledger raises an alert.
  last_reconciled_at  DATETIME(3) NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at          DATETIME(3) NULL,
  PRIMARY KEY (user_id),
  KEY idx_wallets_frozen (is_frozen),
  CONSTRAINT fk_wallets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  -- Balances can never go negative. A spend that would breach this fails the
  -- transaction rather than silently overdrawing.
  CONSTRAINT chk_wallet_non_negative CHECK (
    coin_balance >= 0 AND reward_balance >= 0 AND
    live_gift_balance >= 0 AND withdrawable_amount >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only. No UPDATE, no DELETE — corrections are compensating rows.
CREATE TABLE wallet_ledger (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)        NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  -- Which of the four balances this row moved (ADR-018)
  wallet           ENUM('coin','reward','live_gift','withdrawable') NOT NULL,
  entry_type       ENUM(
    'purchase','gift_sent','gift_received','promotion','ad_spend','refund',
    'admin_credit','admin_debit','task_reward','referral_reward','milestone_reward',
    'reward_to_coins','withdrawal_request','withdrawal_paid','withdrawal_rejected',
    'reversal','clearing'
  ) NOT NULL,
  description      VARCHAR(255)    NOT NULL,
  -- Signed. Coins for coin/reward/live_gift wallets; currency units for withdrawable.
  amount           DECIMAL(14,2)   NOT NULL,
  balance_before   DECIMAL(14,2)   NOT NULL,
  balance_after    DECIMAL(14,2)   NOT NULL,
  status           ENUM('successful','pending','failed','refunded','under_review','approved','rejected')
                   NOT NULL DEFAULT 'successful',
  reference        VARCHAR(64)     NULL,
  -- Fiat leg, when the row came from a real payment or payout
  fiat_amount      DECIMAL(14,2)   NULL,
  fiat_currency    CHAR(4)         NULL,
  -- Prevents a retried request from double-crediting (mandatory on money routes)
  idempotency_key  VARCHAR(64)     NULL,
  related_user_id  BIGINT UNSIGNED NULL,
  admin_id         BIGINT UNSIGNED NULL,
  reason           VARCHAR(500)    NULL,
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ledger_public_id (public_id),
  UNIQUE KEY uq_ledger_idempotency (idempotency_key),
  -- Transaction history: this user's rows, optionally filtered by wallet
  KEY idx_ledger_user (user_id, created_at),
  KEY idx_ledger_user_wallet (user_id, wallet, created_at),
  KEY idx_ledger_reference (reference),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Coin pricing and purchase ──

CREATE TABLE currency_rates (
  code           CHAR(4)        NOT NULL,
  label          VARCHAR(60)    NOT NULL,
  symbol         VARCHAR(8)     NOT NULL,
  coins_per_unit DECIMAL(12,4)  NOT NULL,
  min_amount     DECIMAL(14,2)  NOT NULL DEFAULT 0,
  is_enabled     TINYINT(1)     NOT NULL DEFAULT 1,
  updated_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE coin_packages (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coins        BIGINT UNSIGNED NOT NULL,
  bonus_coins  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  base_price   DECIMAL(12,2)   NOT NULL,
  base_currency CHAR(4)        NOT NULL DEFAULT 'USD',
  discount_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_popular   TINYINT(1)      NOT NULL DEFAULT 0,
  is_enabled   TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order   INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_packages_enabled (is_enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_methods (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug           VARCHAR(40)     NOT NULL,
  label          VARCHAR(80)     NOT NULL,
  kind           ENUM('easypaisa','jazzcash','bank','usdt','card') NOT NULL,
  account_name   VARCHAR(120)    NULL,
  account_number VARCHAR(191)    NULL,
  currencies     JSON            NOT NULL,
  instructions   JSON            NULL,
  -- Manual methods need proof and admin approval; gateways settle automatically.
  is_manual      TINYINT(1)      NOT NULL DEFAULT 1,
  is_enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_methods_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE coin_purchase_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)        NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  method_id      BIGINT UNSIGNED NOT NULL,
  coins          BIGINT UNSIGNED NOT NULL,
  fiat_amount    DECIMAL(14,2)   NOT NULL,
  fiat_currency  CHAR(4)         NOT NULL,
  -- The rate quoted when the request was created. Later rate changes must not
  -- alter what an already-submitted request is worth.
  quoted_rate    DECIMAL(12,4)   NOT NULL,
  transaction_ref VARCHAR(191)   NULL,
  proof_key      VARCHAR(500)    NULL,
  status         ENUM('pending','under_review','approved','rejected') NOT NULL DEFAULT 'pending',
  decided_by     BIGINT UNSIGNED NULL,
  decided_at     DATETIME(3)     NULL,
  decision_note  VARCHAR(500)    NULL,
  -- Set when approved, linking the request to the credit it produced
  ledger_id      BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cpr_public_id (public_id),
  -- Admin approval queue: oldest pending first
  KEY idx_cpr_queue (status, created_at),
  KEY idx_cpr_user (user_id, created_at),
  CONSTRAINT fk_cpr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpr_method FOREIGN KEY (method_id) REFERENCES payment_methods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpr_ledger FOREIGN KEY (ledger_id) REFERENCES wallet_ledger (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gateway payments (card etc.), verified server-side against the provider.
CREATE TABLE payments (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)        NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  provider        VARCHAR(40)     NOT NULL,
  provider_ref    VARCHAR(191)    NOT NULL,
  amount          DECIMAL(14,2)   NOT NULL,
  currency        CHAR(4)         NOT NULL,
  coins           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('pending','successful','failed','refunded') NOT NULL DEFAULT 'pending',
  failure_reason  VARCHAR(255)    NULL,
  ledger_id       BIGINT UNSIGNED NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at      DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_public_id (public_id),
  UNIQUE KEY uq_payments_provider_ref (provider, provider_ref),
  KEY idx_payments_user (user_id, created_at),
  KEY idx_payments_status (status, created_at),
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_ledger FOREIGN KEY (ledger_id) REFERENCES wallet_ledger (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Gifts ──

CREATE TABLE gifts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(40)     NOT NULL,
  name        VARCHAR(60)     NOT NULL,
  icon        VARCHAR(16)     NOT NULL,
  animation_key VARCHAR(500)  NULL,
  coins       BIGINT UNSIGNED NOT NULL,
  is_featured TINYINT(1)      NOT NULL DEFAULT 0,
  is_active   TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order  INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_gifts_slug (slug),
  KEY idx_gifts_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One atomic operation: debit sender coins, credit recipient live_gift, log both.
CREATE TABLE gift_transactions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id         CHAR(26)        NOT NULL,
  gift_id           BIGINT UNSIGNED NOT NULL,
  sender_id         BIGINT UNSIGNED NOT NULL,
  recipient_id      BIGINT UNSIGNED NOT NULL,
  stream_id         BIGINT UNSIGNED NULL,
  quantity          INT UNSIGNED    NOT NULL DEFAULT 1,
  coins_spent       BIGINT UNSIGNED NOT NULL,
  coins_to_creator  BIGINT UNSIGNED NOT NULL,
  sender_ledger_id  BIGINT UNSIGNED NULL,
  recipient_ledger_id BIGINT UNSIGNED NULL,
  created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_gift_tx_public_id (public_id),
  KEY idx_gift_tx_recipient (recipient_id, created_at),
  KEY idx_gift_tx_stream (stream_id),
  CONSTRAINT fk_gt_gift FOREIGN KEY (gift_id) REFERENCES gifts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gt_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gt_recipient FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gt_stream FOREIGN KEY (stream_id) REFERENCES live_streams (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Withdrawals ──

CREATE TABLE payout_methods (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug            VARCHAR(40)     NOT NULL,
  label           VARCHAR(80)     NOT NULL,
  kind            ENUM('usdt','bank','easypaisa','jazzcash') NOT NULL,
  field_label     VARCHAR(80)     NOT NULL,
  network         VARCHAR(40)     NULL,
  min_amount      DECIMAL(14,2)   NOT NULL DEFAULT 0,
  fee_percent     DECIMAL(5,2)    NOT NULL DEFAULT 0,
  processing_time VARCHAR(60)     NULL,
  is_enabled      TINYINT(1)      NOT NULL DEFAULT 1,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payout_methods_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE withdrawal_requests (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id      CHAR(26)        NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  method_id      BIGINT UNSIGNED NOT NULL,
  amount         DECIMAL(14,2)   NOT NULL,
  fee            DECIMAL(14,2)   NOT NULL DEFAULT 0,
  net_amount     DECIMAL(14,2)   NOT NULL,
  currency       CHAR(4)         NOT NULL DEFAULT 'USD',
  destination    VARCHAR(255)    NOT NULL,
  status         ENUM('pending','under_review','approved','paid','rejected') NOT NULL DEFAULT 'pending',
  decided_by     BIGINT UNSIGNED NULL,
  decided_at     DATETIME(3)     NULL,
  settled_at     DATETIME(3)     NULL,
  decision_note  VARCHAR(500)    NULL,
  payout_ref     VARCHAR(191)    NULL,
  ledger_id      BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wr_public_id (public_id),
  KEY idx_wr_queue (status, created_at),
  KEY idx_wr_user (user_id, created_at),
  CONSTRAINT fk_wr_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wr_method FOREIGN KEY (method_id) REFERENCES payout_methods (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wr_ledger FOREIGN KEY (ledger_id) REFERENCES wallet_ledger (id) ON DELETE SET NULL,
  CONSTRAINT chk_wr_amounts CHECK (amount > 0 AND net_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gift earnings mature here before becoming withdrawable (clearing period).
CREATE TABLE gift_clearing (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  gift_tx_id    BIGINT UNSIGNED NOT NULL,
  amount        DECIMAL(14,2)   NOT NULL,
  currency      CHAR(4)         NOT NULL DEFAULT 'USD',
  clears_at     DATETIME(3)     NOT NULL,
  cleared_at    DATETIME(3)     NULL,
  reversed_at   DATETIME(3)     NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- The clearing job scans for rows whose hold has expired
  KEY idx_clearing_due (cleared_at, clears_at),
  KEY idx_clearing_user (user_id),
  CONSTRAINT fk_clearing_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_clearing_tx FOREIGN KEY (gift_tx_id) REFERENCES gift_transactions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Monetization, tasks and referrals ──

CREATE TABLE monetization_criteria (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  criterion_key VARCHAR(40)   NOT NULL,
  label       VARCHAR(80)     NOT NULL,
  metric      VARCHAR(40)     NOT NULL,
  required    BIGINT UNSIGNED NOT NULL,
  unit        VARCHAR(20)     NULL,
  is_boolean  TINYINT(1)      NOT NULL DEFAULT 0,
  is_enabled  TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order  INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_criteria_key (criterion_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_monetization (
  user_id      BIGINT UNSIGNED NOT NULL,
  state        ENUM('locked','eligible','review','enabled','suspended') NOT NULL DEFAULT 'locked',
  progress     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  criteria_met TINYINT UNSIGNED NOT NULL DEFAULT 0,
  applied_at   DATETIME(3)     NULL,
  enabled_at   DATETIME(3)     NULL,
  suspended_at DATETIME(3)     NULL,
  review_note  VARCHAR(500)    NULL,
  decided_by   BIGINT UNSIGNED NULL,
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  KEY idx_monetization_state (state, applied_at),
  CONSTRAINT fk_um_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE daily_tasks (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_key     VARCHAR(40)     NOT NULL,
  title        VARCHAR(120)    NOT NULL,
  description  VARCHAR(255)    NOT NULL DEFAULT '',
  icon         VARCHAR(60)     NULL,
  metric       VARCHAR(40)     NOT NULL,
  target       BIGINT UNSIGNED NOT NULL,
  reward_coins BIGINT UNSIGNED NOT NULL,
  reward_label VARCHAR(20)     NULL,
  is_enabled   TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order   INT UNSIGNED    NOT NULL DEFAULT 0,
  updated_by   BIGINT UNSIGNED NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tasks_key (task_key),
  KEY idx_tasks_enabled (is_enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per user per task per day. The unique key makes double-claiming impossible.
CREATE TABLE user_task_progress (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  task_id     BIGINT UNSIGNED NOT NULL,
  task_date   DATE            NOT NULL,
  progress    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  target      BIGINT UNSIGNED NOT NULL,
  state       ENUM('active','completed','claimed','expired') NOT NULL DEFAULT 'active',
  reward_coins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  claimed_at  DATETIME(3)     NULL,
  ledger_id   BIGINT UNSIGNED NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_task_per_day (user_id, task_id, task_date),
  KEY idx_task_progress_user (user_id, task_date),
  KEY idx_task_progress_state (task_date, state),
  CONSTRAINT fk_utp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_utp_task FOREIGN KEY (task_id) REFERENCES daily_tasks (id) ON DELETE RESTRICT,
  CONSTRAINT fk_utp_ledger FOREIGN KEY (ledger_id) REFERENCES wallet_ledger (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE referrals (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referrer_id   BIGINT UNSIGNED NOT NULL,
  referred_id   BIGINT UNSIGNED NOT NULL,
  code          VARCHAR(20)     NOT NULL,
  -- Set once the referred user meets the qualification rule
  qualified_at  DATETIME(3)     NULL,
  reward_coins  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ledger_id     BIGINT UNSIGNED NULL,
  -- Fraud reversal keeps the row and records why, rather than deleting it
  reversed_at   DATETIME(3)     NULL,
  reversed_reason VARCHAR(255)  NULL,
  signup_ip     VARBINARY(16)   NULL,
  signup_device VARCHAR(128)    NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- A user can only ever be referred once
  UNIQUE KEY uq_referred (referred_id),
  KEY idx_referrals_referrer (referrer_id, created_at),
  KEY idx_referrals_qualified (referrer_id, qualified_at),
  -- Fraud detection: same device or IP signing up repeatedly
  KEY idx_referrals_device (signup_device),
  CONSTRAINT fk_ref_referrer FOREIGN KEY (referrer_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ref_referred FOREIGN KEY (referred_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE referral_codes (
  user_id    BIGINT UNSIGNED NOT NULL,
  code       VARCHAR(20)     NOT NULL,
  created_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_referral_code (code),
  CONSTRAINT fk_rc_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
