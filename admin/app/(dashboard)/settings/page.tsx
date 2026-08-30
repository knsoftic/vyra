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
  PageHeader, SectionCard, Button, Badge, Notice, TextField, Toggle, Select,
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
            <SmsSection settings={state.data.settings} onSaved={reload} />
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
/**
 * SMS configuration.
 *
 * Provider-agnostic, because regional gateways vary far too much to hard-code
 * one — and because the operator changing supplier should not need a deploy.
 * The generic option describes the request with placeholders, which covers
 * almost every gateway that is "call this URL with the number and the message".
 *
 * The credentials are write-only: the API masks them on the way out, so the
 * fields come back blank and a blank field means "leave it as it is".
 */
function SmsSection({
  settings,
  onSaved,
}: {
  settings: Record<string, unknown>;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState(String(settings['sms.provider'] ?? 'none'));
  const [senderId, setSenderId] = useState(String(settings['sms.sender_id'] ?? ''));
  const [countryCode, setCountryCode] = useState(String(settings['sms.default_country_code'] ?? ''));
  const [httpUrl, setHttpUrl] = useState(String(settings['sms.http_url'] ?? ''));
  const [httpMethod, setHttpMethod] = useState(String(settings['sms.http_method'] ?? 'POST'));
  const [httpBody, setHttpBody] = useState(String(settings['sms.http_body'] ?? ''));
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'info' | 'warn' | 'danger'; text: string } | null>(null);

  const keyStored = String(settings['sms.api_key'] ?? '') !== '';
  const secretStored = String(settings['sms.api_secret'] ?? '') !== '';

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      await adminApi.saveSetting('sms.provider', provider);
      await adminApi.saveSetting('sms.sender_id', senderId.trim());
      await adminApi.saveSetting('sms.default_country_code', countryCode.replace(/\D/g, ''));
      await adminApi.saveSetting('sms.http_url', httpUrl.trim());
      await adminApi.saveSetting('sms.http_method', httpMethod);
      await adminApi.saveSetting('sms.http_body', httpBody.trim());
      // Blank means "keep what is stored" — the API never sends them back.
      if (apiKey) await adminApi.saveSetting('sms.api_key', apiKey);
      if (apiSecret) await adminApi.saveSetting('sms.api_secret', apiSecret);
      setApiKey('');
      setApiSecret('');
      setNote({ tone: 'info', text: 'Saved. Codes will go out through this gateway from now on.' });
      onSaved();
    } catch (err) {
      setNote({ tone: 'danger', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="SMS (sign-in codes)"
      description="How one-time codes reach a phone. Without this, signing in by phone number is unavailable and the app says so."
      action={
        <Badge tone={provider === 'none' ? 'warn' : 'success'}>
          {provider === 'none' ? 'Not configured' : provider === 'twilio' ? 'Twilio' : 'Gateway'}
        </Badge>
      }
    >
      <div className="flex flex-col gap-3">
        {provider === 'none' ? (
          <Notice tone="warn" title="Phone sign-in is off">
            No gateway is set, so no code can be delivered. The app refuses phone sign-in rather
            than telling somebody to check a phone that will never ring.
          </Notice>
        ) : null}

        <label className="block">
          <span className="block text-[11px] text-muted mb-1">Provider</span>
          <Select
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'none', label: 'None — phone sign-in disabled' },
              { value: 'http', label: 'Generic HTTP gateway' },
              { value: 'twilio', label: 'Twilio' },
            ]}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label={provider === 'twilio' ? 'From number' : 'Sender ID'}
            value={senderId}
            onChange={setSenderId}
            placeholder={provider === 'twilio' ? '+14155551234' : 'VYRA'}
          />
          <TextField
            label="Default country code"
            value={countryCode}
            onChange={setCountryCode}
            placeholder="92"
            hint="Digits only. Lets people type 0300… instead of +92300…"
          />
        </div>

        <TextField
          label={
            provider === 'twilio'
              ? keyStored ? 'Account SID (stored — leave blank to keep it)' : 'Account SID'
              : keyStored ? 'API key (stored — leave blank to keep it)' : 'API key'
          }
          value={apiKey}
          onChange={setApiKey}
          placeholder={keyStored ? '••••••••' : ''}
          type="password"
        />
        <TextField
          label={
            provider === 'twilio'
              ? secretStored ? 'Auth token (stored — leave blank to keep it)' : 'Auth token'
              : secretStored ? 'API secret (stored — leave blank to keep it)' : 'API secret (if your gateway needs one)'
          }
          value={apiSecret}
          onChange={setApiSecret}
          placeholder={secretStored ? '••••••••' : ''}
          type="password"
        />

        {provider === 'http' ? (
          <>
            <Notice tone="info" title="Describing your gateway">
              Use <code>{'{to}'}</code>, <code>{'{text}'}</code>, <code>{'{key}'}</code>,{' '}
              <code>{'{secret}'}</code> and <code>{'{sender}'}</code> in the URL or the body and
              they are filled in for each message. A body starting with <code>{'{'}</code> that
              parses as JSON is sent as JSON; anything else is sent form-encoded.
            </Notice>

            <TextField
              label="Gateway URL"
              value={httpUrl}
              onChange={setHttpUrl}
              placeholder="https://api.yourgateway.com/send"
            />
            <label className="block">
              <span className="block text-[11px] text-muted mb-1">Method</span>
              <Select
                value={httpMethod}
                onChange={setHttpMethod}
                options={[
                  { value: 'POST', label: 'POST' },
                  { value: 'GET', label: 'GET' },
                ]}
              />
            </label>
            <TextField
              label="Body or query string"
              value={httpBody}
              onChange={setHttpBody}
              multiline
              placeholder="api_key={key}&sender={sender}&to={to}&message={text}"
            />
          </>
        ) : null}

        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Working…' : 'Save SMS settings'}
          </Button>
        </div>

        {note ? (
          <Notice
            tone={note.tone === 'info' ? 'info' : note.tone}
            title={note.tone === 'danger' ? 'Problem' : 'Status'}
          >
            {note.text}
          </Notice>
        ) : null}
      </div>
    </SectionCard>
  );
}
