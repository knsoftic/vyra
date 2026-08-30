import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Button, OtpInput, Pressable, Input } from '../../components';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import { auth as authApi, ApiError } from '../../api';
import type { RootScreenProps } from '../../navigation/types';

const RESEND_SECONDS = 45;

/**
 * Email verification and password reset.
 *
 * The code is checked by the server, which owns the expiry, the single-use rule
 * and the rate limit. This screen never decides whether a code is valid.
 *
 * A reset finishes here rather than on another screen because the server takes
 * the code and the new password in one call: splitting them would mean holding a
 * verified code in navigation state between two screens for no benefit.
 *
 * There is no mail server yet (Phase 13), so in development the API returns the
 * code it issued. It is shown plainly, labelled as a development aid, because a
 * flow nobody can complete is a flow nobody can test.
 */
export function OtpScreen({ navigation, route }: RootScreenProps<'Otp'>) {
  const theme = useTheme();
  const { signIn } = useApp();
  const { backendStatus } = useSession();
  const { email, purpose } = route.params;
  const live = backendStatus === 'live';

  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Set once the code is accepted and a new password is still needed.
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const requestCode = useCallback(async () => {
    if (!live) return;
    setError(null);
    try {
      const result = await authApi.requestOtp(email, purpose);
      setDevCode(result.devCode ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a code.');
    }
  }, [live, email, purpose]);

  // Ask for a code as soon as the screen opens, so the address on screen and the
  // code in the inbox always belong to the same request.
  useEffect(() => {
    void requestCode();
  }, [requestCode]);

  const verify = useCallback(async () => {
    if (code.length !== 6 || verifying) return;
    setVerifying(true);
    setError(null);

    if (!live) {
      // No backend: the screen still has to lead somewhere, but nothing is
      // being verified and the label above says so.
      setVerifying(false);
      if (purpose === 'signup') {
        signIn();
        navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
      } else {
        setVerified(true);
      }
      return;
    }

    try {
      if (purpose === 'reset') {
        // Checked now so a wrong code is reported before asking for a password.
        await authApi.verifyOtp(email, code, 'reset');
        setVerified(true);
      } else {
        await authApi.verifyOtp(email, code, 'signup');
        navigation.navigate('Login');
      }
    } catch (err) {
      setCode('');
      setError(err instanceof ApiError ? err.message : 'That code was not accepted.');
    } finally {
      setVerifying(false);
    }
  }, [code, verifying, live, purpose, email, navigation, signIn]);

  useEffect(() => {
    if (code.length === 6) void verify();
  }, [code, verify]);

  const submitNewPassword = async () => {
    setSaving(true);
    setError(null);
    try {
      if (live) await authApi.resetPassword(email, code, password);
      navigation.navigate('Login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password.');
    } finally {
      setSaving(false);
    }
  };

  if (verified && purpose === 'reset') {
    return (
      <Screen>
        <Header title="Choose a new password" />
        <View style={{ padding: theme.spacing.lg, flex: 1 }}>
          <Text variant="body" tone="secondary">
            Your code was accepted. Pick a new password for {email}.
          </Text>

          <Input
            label="New password"
            value={password}
            onChangeText={setPassword}
            icon="lock-closed-outline"
            secureTextEntry
            autoCapitalize="none"
            containerStyle={{ marginTop: theme.spacing.xl }}
            hint="At least 12 characters."
          />

          {error ? (
            <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.sm }}>
              {error}
            </Text>
          ) : null}

          <Button
            label="Save password"
            variant="gradient"
            size="lg"
            fullWidth
            loading={saving}
            disabled={password.length < 12}
            onPress={() => void submitNewPassword()}
            style={{ marginTop: theme.spacing.lg }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Verify your email" />

      <View style={{ padding: theme.spacing.lg, flex: 1 }}>
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: theme.colors.brandSoft, borderRadius: theme.radius.pill },
          ]}
        >
          <Ionicons name="mail-open-outline" size={26} color={theme.colors.brand} />
        </View>

        <Text variant="h2" align="center" style={{ marginTop: theme.spacing.lg }}>
          Enter the 6-digit code
        </Text>
        <Text variant="body" tone="secondary" align="center" style={{ marginTop: theme.spacing.xs }}>
          Sent to {email}
        </Text>

        {devCode ? (
          <View
            style={[
              styles.devBox,
              {
                backgroundColor: theme.colors.surface,
                borderRadius: theme.radius.md,
                marginTop: theme.spacing.md,
                padding: theme.spacing.sm,
              },
            ]}
          >
            <Ionicons name="construct-outline" size={14} color={theme.colors.gold} />
            <Text variant="caption" tone="muted" style={styles.flex}>
              Development only — no mail server is connected yet. Your code is{' '}
              <Text variant="caption" style={{ color: theme.colors.gold }}>
                {devCode}
              </Text>
              .
            </Text>
          </View>
        ) : null}

        {!live ? (
          <Text variant="caption" tone="muted" align="center" style={{ marginTop: theme.spacing.sm }}>
            The backend is not reachable, so nothing is being verified.
          </Text>
        ) : null}

        <View style={{ marginTop: theme.spacing.xxl }}>
          <OtpInput value={code} onChange={setCode} />
        </View>

        {error ? (
          <Text variant="caption" tone="danger" align="center" style={{ marginTop: theme.spacing.sm }}>
            {error}
          </Text>
        ) : null}

        <View style={[styles.resendRow, { marginTop: theme.spacing.xl }]}>
          {seconds > 0 ? (
            <Text variant="label" tone="muted">
              Resend code in {seconds}s
            </Text>
          ) : (
            <Pressable
              onPress={() => {
                setSeconds(RESEND_SECONDS);
                void requestCode();
              }}
            >
              <Text variant="labelStrong" tone="brand">
                Resend code
              </Text>
            </Pressable>
          )}
        </View>

        <Button
          label={verifying ? 'Verifying' : 'Verify'}
          variant="gradient"
          size="lg"
          fullWidth
          loading={verifying}
          disabled={code.length < 6}
          onPress={() => void verify()}
          style={{ marginTop: theme.spacing.xl }}
        />

        <View style={[styles.hint, { marginTop: theme.spacing.lg }]}>
          <Ionicons name="information-circle-outline" size={14} color={theme.colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            The code expires in 10 minutes and can be used once. Wrong codes are rate
            limited to protect your account.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  resendRow: { alignItems: 'center' },
  hint: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  devBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
