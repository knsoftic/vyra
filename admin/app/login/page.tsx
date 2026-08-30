'use client';

/**
 * Admin sign-in.
 *
 * The credentials are a normal platform account; what admits someone is the
 * admin record the backend resolves after login. A valid account with no admin
 * access gets told exactly that, in one sentence, instead of a dashboard of
 * 403s.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, AdminApiError } from '@/lib/api';
import { Icon } from '@/components/Icon';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/dashboard');
    } catch (err) {
      setError(
        err instanceof AdminApiError
          ? err.offline
            ? 'The API is not reachable. Is the backend running?'
            : err.message
          : 'Sign-in failed.',
      );
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6 justify-center">
          <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center">
            <Icon name="video" size={18} className="text-white" />
          </div>
          <div>
            <div className="text-ink font-semibold text-lg leading-tight">Vyra Admin</div>
            <div className="text-dim text-xs">Operations console</div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="bg-panel border border-border rounded-2xl p-5 flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted font-medium">Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-surface-2 border border-border rounded-lg px-3 h-10 text-sm text-ink outline-none focus:border-brand transition-colors"
              placeholder="you@example.com"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted font-medium">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-surface-2 border border-border rounded-lg px-3 h-10 text-sm text-ink outline-none focus:border-brand transition-colors"
              placeholder="••••••••••"
            />
          </label>

          {error ? (
            <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="h-10 rounded-lg bg-brand text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-[11px] text-dim leading-relaxed">
            Access is limited to accounts with an administrator record. Every sign-in and every
            action here is logged.
          </p>
        </form>
      </div>
    </div>
  );
}
