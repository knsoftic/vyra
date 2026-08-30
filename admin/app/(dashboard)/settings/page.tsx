'use client';

/**
 * App settings, live.
 *
 * Every field writes through `PATCH /admin/settings` on Save, which validates
 * the key against the declared defaults and records who changed what in the
 * audit log. The Email section is the one with teeth: it points the platform's
 * outbox at a real SMTP server — Gmail included — without a deploy, and the
 * Send-test button proves the credentials against the provider before anyone
 * relies on them.
 */

import { useEffect, useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Notice, TextField, Toggle,
} from '@/components/ui';
import { adminApi, type EmailStatus } from '@/lib/api';
import { useAdminData } from '@/lib/useAdminData';

/** Settings shown as plain editable fields, grouped the way operators think. */
const GROUPS: { title: string; description: string; keys: { key: string; label: string; hint?: string }[] }[] = [
  {
    title: 'Application',
    description: 'Identity and the URLs the app shows.',
    keys: [
      { key: 'app.name', label: 'App name' },
      { key: 'app.min_supported_version', label: 'Minimum supported version' },
      { key: 'app.privacy_policy_url', label: 'Privacy policy URL' },
      { key: 'app.terms_url', label: 'Terms of service URL' },
      { key: 'app.guidelines_url', label: 'Community guidelines URL' },
    ],
  },
  {
    title: 'Uploads',
    description: 'Hard limits enforced at upload time.',
    keys: [
      { key: 'upload.max_duration_sec', label: 'Max video duration (seconds)' },
      { key: 'upload.max_size_mb', label: 'Max file size (MB)' },
    ],
  },
  {
    title: 'Feed',
    description: 'Distribution levers. Changes take effect on the next feed request.',
    keys: [
      { key: 'feed.new_creator_exploration_rate', label: 'New-creator exploration rate (0–1)', hint: '0.1 = 10% of impressions go to new creators' },
      { key: 'feed.per_creator_cap', label: 'Per-creator cap per page (0–1)' },
    ],
  },
  {
    title: 'Referrals & tasks',
    description: 'What inviting a friend and finishing the daily list pay.',
    keys: [
      { key: 'referral.reward_coins', label: 'Referral reward (coins)' },
      { key: 'tasks.reset_hour_utc', label: 'Daily task reset hour (UTC)' },
    ],
  },
];

export default function SettingsPage() {
  const { state, reload } = useAdminData(() => adminApi.settings());

  return (
    <>
      <PageHeader
        title="App Settings"
        subtitle="Live platform configuration. Every save is validated, applied immediately, and audited."
      />

      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <div className="grid lg:grid-cols-2 gap-4 items-start">
          <div className="flex flex-col gap-4">
            <EmailSection settings={state.data.settings} onSaved={reload} />
            {GROUPS.slice(0, 2).map((group) => (
              <SettingsGroup key={group.title} group={group} settings={state.data.settings} onSaved={reload} />
            ))}
          </div>
          <div className="flex flex-col gap-4">
            {GROUPS.slice(2).map((group) => (
              <SettingsGroup key={group.title} group={group} settings={state.data.settings} onSaved={reload} />
            ))}
            <MonetizationToggles settings={state.data.settings} onSaved={reload} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function SettingsGroup({
  group,
  settings,
  onSaved,
}: {
  group: (typeof GROUPS)[number];
  settings: Record<string, unknown>;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of group.keys) next[field.key] = String(settings[field.key] ?? '');
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      for (const field of group.keys) {
        const current = String(settings[field.key] ?? '');
        const next = values[field.key] ?? '';
        if (next === current) continue;
        // Numbers go back as numbers — the server rejects a string where a
        // number belongs, which is the point.
        const isNumber = typeof settings[field.key] === 'number';
        await adminApi.saveSetting(field.key, isNumber ? Number(next) : next);
      }
      setNote('Saved.');
      onSaved();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title={group.title}
      description={group.description}
      action={<Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>}
    >
      <div className="flex flex-col gap-3">
        {group.keys.map((field) => (
          <TextField
            key={field.key}
            label={field.hint ? `${field.label} — ${field.hint}` : field.label}
            value={values[field.key] ?? ''}
            onChange={(v: string) => setValues((prev) => ({ ...prev, [field.key]: v }))}
          />
        ))}
        {note ? <div className="text-[11px] text-muted">{note}</div> : null}
      </div>
    </SectionCard>
  );
}

/**
 * The kill switches. Booleans save the moment they are flipped — a switch with
 * a separate Save button is a switch someone leaves half-flipped.
 */
function MonetizationToggles({
  settings,
  onSaved,
}: {
  settings: Record<string, unknown>;
  onSaved: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const flip = async (key: string, next: boolean) => {
    setBusyKey(key);
    try {
      await adminApi.saveSetting(key, next);
      onSaved();
    } finally {
      setBusyKey(null);
    }
  };

  const toggles = [
    { key: 'monetization.enabled', label: 'Monetization', description: 'Master switch for earnings, gifts and withdrawals.' },
    { key: 'monetization.withdrawals_open', label: 'Withdrawals open', description: 'Off pauses new withdrawal requests; nothing pending is lost.' },
    { key: 'ads.enabled', label: 'Promotion & ads', description: 'Off stops promoted slots appearing in feeds.' },
  ];

  return (
    <SectionCard title="Switches" description="Applied immediately. Each flip is audited.">
      <div className="flex flex-col divide-y divide-border/60">
        {toggles.map((t) => (
          <Toggle
            key={t.key}
            checked={settings[t.key] === true}
            onChange={(next) => void flip(t.key, next)}
            label={busyKey === t.key ? `${t.label}…` : t.label}
            description={t.description}
          />
        ))}
      </div>
    </SectionCard>
  );
}

/**
 * SMTP configuration with Gmail instructions in the UI itself, because the
 * person doing this at launch will not have the README open.
 */
function EmailSection({
  settings,
  onSaved,
}: {
  settings: Record<string, unknown>;
  onSaved: () => void;
}) {
  const [host, setHost] = useState(String(settings['email.smtp_host'] ?? ''));
  const [port, setPort] = useState(String(settings['email.smtp_port'] ?? '587'));
  const [user, setUser] = useState(String(settings['email.smtp_user'] ?? ''));
  const [pass, setPass] = useState('');
  const [from, setFrom] = useState(String(settings['email.from'] ?? ''));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'success' | 'danger'; text: string } | null>(null);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [testTo, setTestTo] = useState('');

  const passStored = String(settings['email.smtp_pass'] ?? '') !== '';

  useEffect(() => {
    adminApi.emailStatus().then(setStatus).catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await adminApi.saveSetting('email.smtp_host', host.trim());
      await adminApi.saveSetting('email.smtp_port', Number(port) || 587);
      await adminApi.saveSetting('email.smtp_user', user.trim());
      if (pass) await adminApi.saveSetting('email.smtp_pass', pass);
      await adminApi.saveSetting('email.from', from.trim());
      setNote({ tone: 'success', text: 'Saved. Send a test below to prove delivery.' });
      setPass('');
      setStatus(await adminApi.emailStatus());
      onSaved();
    } catch (err) {
      setNote({ tone: 'danger', text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!testTo.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await adminApi.emailTest(testTo.trim());
      setNote(
        result.sent
          ? { tone: 'success', text: `Sent. Check the inbox at ${testTo.trim()}.` }
          : { tone: 'danger', text: result.detail ?? 'Not sent — no SMTP configured.' },
      );
    } catch (err) {
      setNote({ tone: 'danger', text: err instanceof Error ? err.message : 'Test failed.' });
    } finally {
      setBusy(false);
    }
  };

  const gmail = () => {
    setHost('smtp.gmail.com');
    setPort('587');
  };

  return (
    <SectionCard
      title="Email (SMTP)"
      description="Where verification codes, password resets and notification emails leave from."
      action={
        status ? (
          <Badge tone={status.transport === 'smtp' ? 'success' : 'warn'}>
            {status.transport === 'smtp' ? `SMTP · ${status.host}` : 'Console — not delivering'}
          </Badge>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        <Notice tone="info" title="Using Gmail">
          Press “Use Gmail”, enter your Gmail address as the user, and use an App Password — not
          your normal password. Create one at Google Account → Security → 2-Step Verification →
          App passwords. Gmail allows roughly 500 emails a day; move to a transactional provider
          when you outgrow that.
        </Notice>

        <div className="grid grid-cols-2 gap-3">
          <TextField label="SMTP host" value={host} onChange={setHost} placeholder="smtp.gmail.com" />
          <TextField label="Port" value={port} onChange={setPort} placeholder="587" />
        </div>
        <TextField label="User (your Gmail address)" value={user} onChange={setUser} placeholder="you@gmail.com" />
        <TextField
          label={passStored ? 'App password (stored — leave blank to keep it)' : 'App password'}
          value={pass}
          onChange={setPass}
          placeholder={passStored ? '••••••••' : '16-character app password'}
          type="password"
        />
        <TextField label="From (optional)" value={from} onChange={setFrom} placeholder="Vyra <you@gmail.com>" />

        <div className="flex items-center gap-2">
          <Button onClick={gmail}>Use Gmail</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Working…' : 'Save email settings'}
          </Button>
        </div>

        <div className="border-t border-border pt-3 flex items-end gap-2">
          <div className="flex-1">
            <TextField label="Send a test to" value={testTo} onChange={setTestTo} placeholder="you@example.com" />
          </div>
          <Button onClick={() => void test()} disabled={busy || !testTo.trim()}>Send test</Button>
        </div>

        {note ? <Notice tone={note.tone === 'success' ? 'info' : note.tone}
          title={note.tone === 'danger' ? 'Problem' : 'Status'}>{note.text}</Notice> : null}
      </div>
    </SectionCard>
  );
}
