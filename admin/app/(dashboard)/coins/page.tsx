'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function CoinsPage() {
  return (
    <CataloguePage
      title="Coin Packages"
      subtitle="What buyers see in the coin store. Prices are in the base currency; per-currency rates live under Rates & Methods."
      path="coin-packages"
      columns={[
        { key: 'coins', label: 'Coins', kind: 'number', writeAs: 'coins', align: 'right' },
        { key: 'bonusCoins', label: 'Bonus', kind: 'number', writeAs: 'bonus_coins', align: 'right' },
        { key: 'price', label: 'Price', kind: 'number', writeAs: 'base_price', align: 'right' },
        { key: 'currency', label: 'Currency', kind: 'readonly' },
        { key: 'discountPercent', label: 'Discount %', kind: 'number', writeAs: 'discount_percent', align: 'right' },
        { key: 'isPopular', label: 'Popular', kind: 'toggle', writeAs: 'is_popular', align: 'center' },
        { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
      ]}
    />
  );
}
