/**
 * Login activity and password changes.
 *
 * Both were rows in Settings that did nothing, while the endpoints behind them
 * already existed. A dead control in a security section is worse than no
 * control: it tells someone their account has a protection it does not have.
 *
 * Everything here is a server fact. Sessions and security events are read from
 * the account, revoking a session revokes it centrally rather than locally, and
 * a password change re-checks the current password server-side.
 */

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Card,
  ListRow,
  Divider,
  SectionHeader,
  Button,
  Input,
  EmptyState,
  Badge,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApiData } from '../../hooks/useApiData';
import { useSession } from '../../store/SessionState';
import { auth as authApi, account, ApiError } from '../../api';
import { timeAgo } from '../../utils/format';
import type { RootScreenProps } from '../../navigation/types';

/** Security events are named for the log; people need words. */
const EVENT_LABELS: Record<string, string> = {
  login_success: 'Signed in',
  login_failed: 'Failed sign-in attempt',
  logout: 'Signed out',
  password_changed: 'Password changed',
  password_reset: 'Password reset',
  session_revoked: 'Session revoked',
  sessions_revoked_all: 'Signed out everywhere',
  user_blocked: 'Blocked an account',
  user_unblocked: 'Unblocked an account',
  otp_requested: 'Verification code requested',
  otp_failed: 'Incorrect verification code',
};

export function LoginActivityScreen({}: RootScreenProps<'LoginActivity'>) {
  const theme = useTheme();
  const { backendStatus, isSignedIn, signOut } = useSession();
  const live = backendStatus === 'live' && isSignedIn;

  const { data: sessions, source, refresh } = useApiData(() => authApi.sessions(), [], []);
  const { data: events } = useApiData(() => account.securityEvents(), [], []);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const revoke = async (sessionId: string) => {
    setBusy(sessionId);
    setError(null);
    try {
      await account.revokeSession(sessionId);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not end that session.');
    } finally {
      setBusy(null);
    }
  };

  const signOutEverywhere = async () => {
    setBusy('all');
    setError(null);
    try {
      await account.logoutAll();
      // Every session is gone, including this one, so the local session has to
      // follow rather than pretending it survived.
      await signOut();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign out everywhere.');
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Header title="Login activity" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <SourceNote
          source={live ? source : 'sample'}
          noun="sessions"
          sampleHint="sign in to see the devices on your account"
        />

        {error ? (
          <Text variant="caption" tone="danger" style={{ paddingHorizontal: theme.spacing.md }}>
            {error}
          </Text>
        ) : null}

        <SectionHeader title="Signed-in devices" />
        {sessions.length === 0 ? (
          <EmptyState icon="phone-portrait-outline" title="No other sessions" compact />
        ) : (
          <Card>
            {sessions.map((session, index) => (
              <View key={session.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <ListRow
                  label={session.device}
                  description={`${session.platform} · last active ${timeAgo(session.lastActiveAt)}`}
                  icon="phone-portrait-outline"
                  showChevron={false}
                  right={
                    session.isCurrent ? (
                      <Badge label="This device" tone="accent" size="sm" />
                    ) : (
                      <Button
                        label="End"
                        variant="secondary"
                        size="sm"
                        loading={busy === session.id}
                        onPress={() => void revoke(session.id)}
                      />
                    )
                  }
                />
              </View>
            ))}
          </Card>
        )}

        <View style={{ padding: theme.spacing.md }}>
          <Button
            label="Sign out everywhere"
            variant="secondary"
            icon="log-out-outline"
            fullWidth
            loading={busy === 'all'}
            onPress={() => void signOutEverywhere()}
          />
          <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.xs }}>
            Ends every session including this one. Your videos, drafts, wallet and messages
            are untouched.
          </Text>
        </View>

        <SectionHeader title="Recent security activity" />
        {events.length === 0 ? (
          <EmptyState icon="shield-checkmark-outline" title="Nothing recorded yet" compact />
        ) : (
          <Card>
            {events.slice(0, 20).map((event, index) => (
              <View key={event.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <ListRow
                  label={EVENT_LABELS[event.event] ?? event.event.replace(/_/g, ' ')}
                  description={[event.device, timeAgo(event.createdAt)]
                    .filter(Boolean)
                    .join(' · ')}
                  icon={event.outcome === 'failure' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                  iconColor={event.outcome === 'failure' ? theme.colors.danger : theme.colors.success}
                  showChevron={false}
                />
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

export function ChangePasswordScreen({ navigation }: RootScreenProps<'ChangePassword'>) {
  const theme = useTheme();
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = live && current.length > 0 && next.length >= 12 && next === confirm;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await account.changePassword(current, next);
      setDone(true);
      // Other sessions are revoked server-side by the change, which is the
      // point of changing a password in the first place.
      setTimeout(() => navigation.goBack(), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Header title="Change password" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16 }}>
        {!live ? (
          <SourceNote
            source="sample"
            noun="account"
            sampleHint="sign in with a reachable backend to change your password"
          />
        ) : null}

        {done ? (
          <View style={styles.doneRow}>
            <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
            <Text variant="body" tone="secondary">
              Password changed. Other devices have been signed out.
            </Text>
          </View>
        ) : null}

        <Input
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          icon="lock-closed-outline"
          secureTextEntry
          autoCapitalize="none"
        />
        <Input
          label="New password"
          value={next}
          onChangeText={setNext}
          icon="key-outline"
          secureTextEntry
          autoCapitalize="none"
          hint="At least 12 characters."
          containerStyle={{ marginTop: theme.spacing.md }}
        />
        <Input
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          icon="key-outline"
          secureTextEntry
          autoCapitalize="none"
          error={mismatch ? 'The two passwords do not match.' : undefined}
          containerStyle={{ marginTop: theme.spacing.md }}
        />

        {error ? (
          <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.sm }}>
            {error}
          </Text>
        ) : null}

        <Button
          label="Change password"
          variant="gradient"
          size="lg"
          fullWidth
          loading={saving}
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={{ marginTop: theme.spacing.lg }}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  doneRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingBottom: 12 },
});
