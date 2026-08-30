import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Input, Button } from '../../components';
import { useTheme } from '../../theme';
import { useSession } from '../../store/SessionState';
import { auth as authApi, ApiError } from '../../api';
import type { RootScreenProps } from '../../navigation/types';

export function ForgotPasswordScreen({ navigation }: RootScreenProps<'ForgotPassword'>) {
  const theme = useTheme();
  const { backendStatus } = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The response is deliberately the same whether or not the address exists, so
   * this screen moves on regardless. Only a transport failure is worth reporting
   * — anything else would leak which addresses are registered.
   */
  const requestReset = async () => {
    setSending(true);
    setError(null);
    try {
      if (backendStatus === 'live') await authApi.requestOtp(email.trim(), 'reset');
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError && !err.offline ? err.message : null);
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen>
      <Header title="Reset password" />

      <View style={{ padding: theme.spacing.lg, flex: 1 }}>
        {sent ? (
          <View style={styles.center}>
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: theme.colors.successSoft, borderRadius: theme.radius.pill },
              ]}
            >
              <Ionicons name="checkmark-circle-outline" size={30} color={theme.colors.success} />
            </View>
            <Text variant="h2" align="center" style={{ marginTop: theme.spacing.lg }}>
              Check your email
            </Text>
            <Text variant="body" tone="secondary" align="center" style={{ marginTop: theme.spacing.xs }}>
              If an account exists for {email || 'that address'}, we have sent a reset code.
            </Text>

            <Button
              label="Enter reset code"
              variant="gradient"
              size="lg"
              fullWidth
              onPress={() =>
                navigation.navigate('Otp', { email: email.trim() || 'you@example.com', purpose: 'reset' })
              }
              style={{ marginTop: theme.spacing.xl }}
            />
          </View>
        ) : (
          <>
            <Text variant="h2">Forgot your password?</Text>
            <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
              Enter the email on your account and we will send you a code to reset it.
            </Text>

            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              icon="mail-outline"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              containerStyle={{ marginTop: theme.spacing.xl }}
            />

            <Button
              label="Send reset code"
              variant="gradient"
              size="lg"
              fullWidth
              loading={sending}
              disabled={email.trim().length === 0}
              onPress={() => void requestReset()}
              style={{ marginTop: theme.spacing.lg }}
            />

            {error ? (
              <Text variant="caption" tone="danger" style={{ marginTop: theme.spacing.sm }}>
                {error}
              </Text>
            ) : null}

            <View style={[styles.hint, { marginTop: theme.spacing.lg }]}>
              <Ionicons name="shield-outline" size={14} color={theme.colors.textMuted} />
              <Text variant="caption" tone="muted" style={styles.flex}>
                For your security we show the same message whether or not an account
                exists for this address.
              </Text>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', paddingTop: 40 },
  iconWrap: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center' },
  hint: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
