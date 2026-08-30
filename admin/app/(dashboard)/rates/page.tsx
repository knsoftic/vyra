'use client';

/**
 * Everything money converts through: how buyers pay in, how creators are paid
 * out, and what a coin costs per currency. The preflight checks this page's
 * data for placeholder account numbers — money paid into a placeholder account
 * is money that goes nowhere.
 */

import { useEffect, useState } from 'react';
import { PageHeader, SectionCard, Button, Notice, TextField } from '@/components/ui';
import { CatalogueSection } from '@/components/Catalogue';
import { adminApi } from '@/lib/api';
import { useAdminData } from '@/lib/useAdminData';

export default function RatesPage() {
  return (
    <>
      <PageHeader
        title="Rates & Methods"
        subtitle="Payment accounts buyers send to, payout channels creators withdraw through, and per-currency coin rates."
      />
      <div className="flex flex-col gap-4">
        <CatalogueSection
          path="payment-methods"
          cardTitle="Payment methods (money in)"
          cardDescription="REPLACE the account name and number with your real accounts before launch — the preflight fails while placeholders remain."
          columns={[
            { key: 'label', label: 'Method', kind: 'text', writeAs: 'label' },
            { key: 'kind', label: 'Kind', kind: 'badge' },
            { key: 'accountName', label: 'Account name', kind: 'text', writeAs: 'account_name' },
            { key: 'accountNumber', label: 'Account number', kind: 'text', writeAs: 'account_number' },
            { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
          ]}
        />
        <CatalogueSection
          path="payout-methods"
          cardTitle="Payout methods (money out)"
          columns={[
            { key: 'label', label: 'Method', kind: 'text', writeAs: 'label' },
            { key: 'kind', label: 'Kind', kind: 'badge' },
            { key: 'minAmount', label: 'Minimum', kind: 'number', writeAs: 'min_amount', align: 'right' },
            { key: 'feePercent', label: 'Fee %', kind: 'number', writeAs: 'fee_percent', align: 'right' },
            { key: 'processingTime', label: 'Processing', kind: 'text', writeAs: 'processing_time' },
            { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
          ]}
          createLabel="Add payout method"
          createFields={[
            { column: 'slug', label: 'Slug', kind: 'string', required: true, placeholder: 'easypaisa_out' },
            { column: 'label', label: 'Label', kind: 'string', required: true, placeholder: 'Easypaisa' },
            { column: 'kind', label: 'Kind', kind: 'string', required: true, placeholder: 'easypaisa', help: 'usdt, bank, easypaisa, jazzcash' },
            { column: 'field_label', label: 'What to ask the creator', kind: 'string', required: true, placeholder: 'Easypaisa number' },
            { column: 'min_amount', label: 'Minimum', kind: 'number', placeholder: '50' },
            { column: 'fee_percent', label: 'Fee %', kind: 'number', placeholder: '2' },
            { column: 'processing_time', label: 'Processing time', kind: 'string', placeholder: '1-2 business days' },
            { column: 'is_enabled', label: 'Enabled', kind: 'boolean' },
          ]}
        />
        <CoinRates />
      </div>
    </>
  );
}

/**
 * The rates coin purchases are actually quoted at — the `coins.rates` setting,
 * which is what the purchase flow reads. One number per currency: how many
 * coins one unit buys. A request keeps the rate quoted when it was made, so
 * changing this never re-prices anything already submitted.
 */
function CoinRates() {
  const { state, reload } = useAdminData(() => adminApi.settings());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState('');
  const [newRate, setNewRate] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const rates: Record<string, number> =
    state.status === 'live' && typeof state.data.settings['coins.rates'] === 'object'
      ? (state.data.settings['coins.rates'] as Record<string, number>)
      : {};

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const [code, rate] of Object.entries(rates)) next[code] = String(rate);
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status]);

  const save = async (extra?: { code: string; rate: number }) => {
    setBusy(true);
    setNote(null);
    try {
      const next: Record<string, number> = {};
      for (const [code, value] of Object.entries(drafts)) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`'${code}' needs a positive number.`);
        next[code] = parsed;
      }
      if (extra) next[extra.code] = extra.rate;
      await adminApi.saveSetting('coins.rates', next);
      setNote('Saved. New purchase quotes use these rates immediately; submitted requests keep theirs.');
      setNewCode('');
      setNewRate('');
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Coin purchase rates"
      description="Coins one unit of each currency buys. This is the live quote for the Buy Coins screen."
      action={<Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save rates'}</Button>}
    >
      <div className="flex flex-col gap-3 max-w-md">
        {Object.keys(drafts).map((code) => (
          <TextField
            key={code}
            label={`${code} — coins per 1 ${code}`}
            value={drafts[code] ?? ''}
            onChange={(v: string) => setDrafts((prev) => ({ ...prev, [code]: v }))}
          />
        ))}
        <div className="flex items-end gap-2 border-t border-border pt-3">
          <TextField label="Add currency (code)" value={newCode} onChange={(v: string) => setNewCode(v.toUpperCase().slice(0, 4))} placeholder="AED" />
          <TextField label="Coins per unit" value={newRate} onChange={setNewRate} placeholder="27" />
          <Button
            onClick={() => {
              const rate = Number(newRate);
              if (!newCode.trim() || !Number.isFinite(rate) || rate <= 0) return;
              void save({ code: newCode.trim(), rate });
            }}
            disabled={busy || !newCode.trim() || !newRate.trim()}
          >
            Add
          </Button>
        </div>
        {note ? <Notice tone="info" title="Status">{note}</Notice> : null}
      </div>
    </SectionCard>
  );
}
