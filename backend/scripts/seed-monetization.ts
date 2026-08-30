/**
 * Coin packages, payment and payout methods, and daily tasks.
 *
 * All of it is admin-editable (ADR-015). These are starting values, and the
 * script is idempotent: it creates what is missing and leaves what exists
 * alone. Prices and reward amounts in particular are never overwritten, because
 * changing what something costs or pays underneath people who are mid-purchase
 * or mid-task is a decision an operator makes deliberately, not a side effect of
 * re-running a seed.
 *
 * The account numbers below are obvious placeholders. A real deployment
 * replaces them from the admin panel — nobody should be able to run this and
 * accidentally accept money into an address that came from a seed file.
 */

import { execute, query, closeDb } from '../src/core/db.ts';
import { closeRedis } from '../src/core/redis.ts';

interface Pkg {
  coins: number;
  bonus: number;
  price: number;
  popular?: boolean;
  discount?: number;
}

const PACKAGES: Pkg[] = [
  { coins: 100, bonus: 0, price: 1 },
  { coins: 500, bonus: 25, price: 5, discount: 5 },
  { coins: 1000, bonus: 100, price: 10, popular: true, discount: 10 },
  { coins: 2500, bonus: 350, price: 25, discount: 14 },
  { coins: 5000, bonus: 900, price: 50, discount: 18 },
  { coins: 10000, bonus: 2200, price: 100, discount: 22 },
];

interface PayMethod {
  slug: string;
  label: string;
  kind: 'easypaisa' | 'jazzcash' | 'bank' | 'usdt' | 'card';
  accountName: string;
  accountNumber: string;
  currencies: string[];
  /** Steps the buyer follows. Stored as JSON, so the app can number them. */
  instructions: string[];
}

const PAYMENT_METHODS: PayMethod[] = [
  {
    slug: 'easypaisa',
    label: 'Easypaisa',
    kind: 'easypaisa',
    accountName: 'REPLACE IN ADMIN',
    accountNumber: '0000-0000000',
    currencies: ['PKR'],
    instructions: [
      'Open Easypaisa and send the exact amount shown to the number above.',
      'Copy the transaction ID from your receipt.',
      'Paste it below and submit. Coins are added once we confirm the transfer.',
    ],
  },
  {
    slug: 'jazzcash',
    label: 'JazzCash',
    kind: 'jazzcash',
    accountName: 'REPLACE IN ADMIN',
    accountNumber: '0000-0000000',
    currencies: ['PKR'],
    instructions: [
      'Open JazzCash and send the exact amount shown to the number above.',
      'Copy the transaction ID from your receipt.',
      'Paste it below and submit. Coins are added once we confirm the transfer.',
    ],
  },
  {
    slug: 'bank',
    label: 'Bank transfer',
    kind: 'bank',
    accountName: 'REPLACE IN ADMIN',
    accountNumber: 'PK00 0000 0000 0000',
    currencies: ['PKR', 'USD'],
    instructions: [
      'Transfer the exact amount to the account above.',
      'Enter your bank reference number below.',
      'Bank transfers can take a working day to confirm.',
    ],
  },
  {
    slug: 'usdt-trc20',
    label: 'USDT (TRC20)',
    kind: 'usdt',
    accountName: 'USDT TRC20',
    accountNumber: 'REPLACE-IN-ADMIN',
    currencies: ['USD'],
    instructions: [
      'Send USDT on the TRON (TRC20) network only — other networks will be lost.',
      'Paste the transaction hash below.',
      'Confirmations usually take a few minutes.',
    ],
  },
];

interface PayoutMethod {
  slug: string;
  label: string;
  kind: 'usdt' | 'bank' | 'easypaisa' | 'jazzcash';
  fieldLabel: string;
  network?: string;
  minAmount: number;
  feePercent: number;
  processingTime: string;
}

const PAYOUT_METHODS: PayoutMethod[] = [
  {
    slug: 'easypaisa',
    label: 'Easypaisa',
    kind: 'easypaisa',
    fieldLabel: 'Easypaisa number',
    minAmount: 50,
    feePercent: 2,
    processingTime: '1-2 business days',
  },
  {
    slug: 'jazzcash',
    label: 'JazzCash',
    kind: 'jazzcash',
    fieldLabel: 'JazzCash number',
    minAmount: 50,
    feePercent: 2,
    processingTime: '1-2 business days',
  },
  {
    slug: 'bank',
    label: 'Bank transfer',
    kind: 'bank',
    fieldLabel: 'IBAN or account number',
    minAmount: 100,
    feePercent: 1,
    processingTime: '3-5 business days',
  },
  {
    slug: 'usdt-trc20',
    label: 'USDT (TRC20)',
    kind: 'usdt',
    fieldLabel: 'TRC20 wallet address',
    network: 'TRC20',
    minAmount: 50,
    feePercent: 1,
    processingTime: 'Within 24 hours',
  },
];

interface Task {
  key: string;
  title: string;
  description: string;
  icon: string;
  /** Must match a counter the server can measure — see `rewards.service`. */
  metric: string;
  target: number;
  reward: number;
}

const TASKS: Task[] = [
  {
    key: 'watch_10_minutes',
    title: 'Watch 10 minutes',
    description: 'Spend ten minutes watching videos today.',
    icon: 'play-circle-outline',
    metric: 'watch_minutes',
    target: 10,
    reward: 20,
  },
  {
    key: 'like_5',
    title: 'Like 5 videos',
    description: 'Show five creators you enjoyed their work.',
    icon: 'heart-outline',
    metric: 'likes_given',
    target: 5,
    reward: 10,
  },
  {
    key: 'comment_3',
    title: 'Leave 3 comments',
    description: 'Join the conversation on three videos.',
    icon: 'chatbubble-outline',
    metric: 'comments_posted',
    target: 3,
    reward: 15,
  },
  {
    key: 'follow_2',
    title: 'Follow 2 creators',
    description: 'Find two new accounts worth following.',
    icon: 'person-add-outline',
    metric: 'follows_made',
    target: 2,
    reward: 10,
  },
  {
    key: 'post_1',
    title: 'Post a video',
    description: 'Share something of your own today.',
    icon: 'videocam-outline',
    metric: 'videos_posted',
    target: 1,
    reward: 50,
  },
];

async function seedPackages(): Promise<number> {
  let created = 0;
  for (const [index, pkg] of PACKAGES.entries()) {
    const existing = await query<{ id: number }>(
      'SELECT id FROM coin_packages WHERE coins = :coins',
      { coins: pkg.coins },
    );
    if (existing.length > 0) continue;

    await execute(
      `INSERT INTO coin_packages
         (coins, bonus_coins, base_price, base_currency, discount_percent,
          is_popular, is_enabled, sort_order)
       VALUES (:coins, :bonus, :price, 'USD', :discount, :popular, 1, :sortOrder)`,
      {
        coins: pkg.coins,
        bonus: pkg.bonus,
        price: pkg.price,
        discount: pkg.discount ?? 0,
        popular: pkg.popular ? 1 : 0,
        sortOrder: index,
      },
    );
    created += 1;
  }
  return created;
}

async function seedPaymentMethods(): Promise<number> {
  let created = 0;
  for (const method of PAYMENT_METHODS) {
    const existing = await query<{ id: number }>(
      'SELECT id FROM payment_methods WHERE slug = :slug',
      { slug: method.slug },
    );
    if (existing.length > 0) continue;

    await execute(
      `INSERT INTO payment_methods
         (slug, label, kind, account_name, account_number, currencies, instructions,
          is_manual, is_enabled)
       VALUES (:slug, :label, :kind, :accountName, :accountNumber, :currencies, :instructions, 1, 1)`,
      {
        slug: method.slug,
        label: method.label,
        kind: method.kind,
        accountName: method.accountName,
        accountNumber: method.accountNumber,
        currencies: JSON.stringify(method.currencies),
        instructions: JSON.stringify(method.instructions),
      },
    );
    created += 1;
  }
  return created;
}

async function seedPayoutMethods(): Promise<number> {
  let created = 0;
  for (const method of PAYOUT_METHODS) {
    const existing = await query<{ id: number }>(
      'SELECT id FROM payout_methods WHERE slug = :slug',
      { slug: method.slug },
    );
    if (existing.length > 0) continue;

    await execute(
      `INSERT INTO payout_methods
         (slug, label, kind, field_label, network, min_amount, fee_percent,
          processing_time, is_enabled)
       VALUES (:slug, :label, :kind, :fieldLabel, :network, :minAmount, :feePercent,
               :processingTime, 1)`,
      {
        slug: method.slug,
        label: method.label,
        kind: method.kind,
        fieldLabel: method.fieldLabel,
        network: method.network ?? null,
        minAmount: method.minAmount,
        feePercent: method.feePercent,
        processingTime: method.processingTime,
      },
    );
    created += 1;
  }
  return created;
}

async function seedTasks(): Promise<number> {
  let created = 0;
  for (const [index, task] of TASKS.entries()) {
    const existing = await query<{ id: number }>(
      'SELECT id FROM daily_tasks WHERE task_key = :key',
      { key: task.key },
    );
    if (existing.length > 0) continue;

    await execute(
      `INSERT INTO daily_tasks
         (task_key, title, description, icon, metric, target, reward_coins,
          reward_label, is_enabled, sort_order)
       VALUES (:key, :title, :description, :icon, :metric, :target, :reward,
               'coins', 1, :sortOrder)`,
      {
        key: task.key,
        title: task.title,
        description: task.description,
        icon: task.icon,
        metric: task.metric,
        target: task.target,
        reward: task.reward,
        sortOrder: index,
      },
    );
    created += 1;
  }
  return created;
}

async function main(): Promise<void> {
  console.log('\n  Seeding monetization configuration\n');

  console.log(`  ${await seedPackages()} coin package(s) created`);
  console.log(`  ${await seedPaymentMethods()} payment method(s) created`);
  console.log(`  ${await seedPayoutMethods()} payout method(s) created`);
  console.log(`  ${await seedTasks()} daily task(s) created`);

  console.log('\n  Account numbers are placeholders — set the real ones in the admin panel.\n');
}

main()
  .catch((err: unknown) => {
    console.error('  Seeding failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    await closeRedis();
  });
