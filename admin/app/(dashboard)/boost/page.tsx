'use client';

/**
 * Boost / advertising levers. These are settings, not table rows — each save
 * goes through the validated settings endpoint and is audited.
 */

import { useEffect, useState } from 'react';
import { PageHeader, SectionCard, Button, Notice, TextField, Toggle } from '@/components/ui';
import { adminApi } from '@/lib/api';
import { useAdminData } from '@/lib/useAdminData';

const FIELDS: { key: string; label: string; hint: string }[] = [
  { key: 'ads.cost_per_impression', label: 'Cost per impression (coins)', hint: 'What one promoted view of a feed card costs the advertiser.' },
  { key: 'ads.cost_per_view', label: 'Cost per 2s view (coins)', hint: 'Charged when a promoted video is actually watched.' },
  { key: 'ads.min_budget_coins', label: 'Minimum campaign budget (coins)', hint: 'Campaigns below this are refused at creation.' },
  { key: 'ads.feed_density', label: 'Feed density (0–0.5)', hint: '0.15 = at most 3 promoted slots in a 20-item page. Never the first slot.' },
  { key: 'ads.frequency_cap_per_day', label: 'Frequency cap per day', hint: 'One person sees one campaign at most this many times a day.' },
];

export default function BoostPage() {
  const { state, reload } = useAdminData(() => adminApi.settings());
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== 'live') return;
    const next: Record<string, string> = {};
    for (const field of FIELDS) next[field.key] = String(state.data.settings[field.key] ?? '');
    setValues(next);
  }, [state]);

  const save = async () => {
    if (state.status !== 'live') return;
    setBusy(true);
    setNote(null);
    try {
      for (const field of FIELDS) {
        const current = String(state.data.settings[field.key] ?? '');
        const next = values[field.key] ?? '';
        if (next === current) continue;
        await adminApi.saveSetting(field.key, Number(next));
      }
      setNote('Saved. Takes effect on the next feed request — no deploy, no restart.');
      reload();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Boost Settings"
        subtitle="What promotion costs and how much of a feed it may occupy. Promotion buys distribution, never engagement numbers."
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="max-w-xl flex flex-col gap-4">
          <SectionCard
            title="Delivery pricing"
            action={<Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>}
          >
            <div className="flex flex-col gap-3">
              {FIELDS.map((field) => (
                <TextField
                  key={field.key}
                  label={`${field.label} — ${field.hint}`}
                  value={values[field.key] ?? ''}
                  onChange={(v: string) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              ))}
              {note ? <div className="text-[11px] text-muted">{note}</div> : null}
            </div>
          </SectionCard>

          <SectionCard title="Master switch">
            <Toggle
              checked={state.data.settings['ads.enabled'] === true}
              onChange={(next) => void adminApi.saveSetting('ads.enabled', next).then(reload)}
              label="Promotion enabled"
              description="Off removes promoted slots from every feed immediately. Campaign budgets are untouched."
            />
          </SectionCard>
        </div>
      ) : null}
    </>
  );
}
