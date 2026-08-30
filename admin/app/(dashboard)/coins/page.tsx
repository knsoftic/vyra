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
      createLabel="Add package"
      createFields={[
        { column: 'coins', label: 'Coins', kind: 'number', required: true, placeholder: '500' },
        { column: 'base_price', label: 'Price', kind: 'number', required: true, placeholder: '4.99' },
        { column: 'base_currency', label: 'Currency', kind: 'string', required: true, placeholder: 'USD' },
        { column: 'bonus_coins', label: 'Bonus coins', kind: 'number' },
        { column: 'discount_percent', label: 'Discount %', kind: 'number' },
        { column: 'sort_order', label: 'Order', kind: 'number' },
        { column: 'is_popular', label: 'Popular', kind: 'boolean' },
        { column: 'is_enabled', label: 'Enabled', kind: 'boolean' },
      ]}
    />
  );
}
