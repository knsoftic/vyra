import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Input, Button, Pressable } from '../../components';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import type { RootScreenProps } from '../../navigation/types';

/** Seconds before another code can be asked for; matches the server's rule. */
const RESEND_SECONDS = 60;

/**
 * Signing in with a phone number.
 *
 * One screen, two steps, no branch for "do you have an account?" — the server
 * knows, and asking someone a question the system can answer is how sign-up
 * flows end up with two accounts for one person.
 *
 * The code is the authentication: verifying it returns a session, so there is
 * no password to set and no second sign-in step.
 */
export function PhoneLoginScreen({ navigation }: RootScreenProps<'PhoneLogin'>) {
  const theme = useTheme();
  const { signIn: signInLocal } = useApp();
  const { requestPhoneCode, verifyPhoneCode, loading, error, backendStatus } = useSession();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [cooldown > 0]);

  const sendCode = async () => {
    setNotice(null);
    try {
      const result = await requestPhoneCode(phone);
      setSentTo(result.phone);
      setCooldown(RESEND_SECONDS);

      /*
       * `sent: false` means the platform has no SMS gateway configured. Saying
       * so is the whole point — telling someone to check a phone that will
       * never ring is the failure this screen exists to avoid. In development
       * the code comes back in the response so the flow is still testable.
       */
      if (!result.sent) {
        setNotice(
          result.devCode
            ? `No SMS gateway is configured. Development code: ${result.devCode}`
            : 'No SMS gateway is configured, so no code was sent. Use your email address instead.',
        );
      }
    } catch {
      // The message is already on the session.
    }
  };

  const verify = async () => {
    if (!sentTo) return;
    try {
      const { isNewAccount } = await verifyPhoneCode(sentTo, code);
      signInLocal();
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });

      /*
       * A brand new account has an auto-generated username and no display name,
       * so it is sent straight to Edit Profile — pushed on top of the feed
       * rather than replacing it, so skipping lands somewhere sensible instead
       * of on a dead end.
       */
      if (isNewAccount) navigation.navigate('EditProfile');
    } catch {
      // Shown from the session error below.
    }
  };

  const canSend = phone.trim().length >= 6 && cooldown === 0;
  const canVerify = code.trim().length === 6;

  return (
    <Screen>
      <Header showBack={navigation.canGoBack()} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="h1">{sentTo ? 'Enter your code' : 'Continue with phone'}</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
            {sentTo
              ? `We sent a 6-digit code to +${sentTo}. It expires in 10 minutes.`
              : 'We will text you a code. If you have an account we will sign you in; if not, we will make one.'}
          </Text>

          <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.xl }}>
            {!sentTo ? (
              <Input
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                icon="call-outline"
                placeholder="+92 300 1234567"
                keyboardType="phone-pad"
                autoComplete="tel"
              />
            ) : (
              <Input
                label="Code"
                value={code}
                onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, 6))}
                icon="keypad-outline"
                placeholder="123456"
                keyboardType="number-pad"
                autoComplete="sms-otp"
              />
            )}
          </View>

          {notice ? (
            <View
              style={[
                styles.notice,
                {
                  marginTop: theme.spacing.md,
                  padding: theme.spacing.sm,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.colors.surfaceAlt,
                },
              ]}
            >
              <Ionicons name="information-circle-outline" size={16} color={theme.colors.textMuted} />
              <Text variant="label" tone="secondary" style={styles.flex}>
                {notice}
              </Text>
            </View>
          ) : null}

          {error ? (
            <View
              style={{
                marginTop: theme.spacing.md,
                padding: theme.spacing.sm,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.dangerSoft ?? 'rgba(255,80,80,0.12)',
              }}
            >
              <Text variant="label" tone="danger">
                {error}
              </Text>
            </View>
          ) : null}

          {backendStatus === 'offline' ? (
            <Text
              variant="caption"
              tone="muted"
              style={{ marginTop: theme.spacing.sm, textAlign: 'center' }}
            >
              Server offline — start the backend to sign in.
            </Text>
          ) : null}

          <Button
            label={sentTo ? 'Verify and continue' : 'Send code'}
            variant="gradient"
            size="lg"
            fullWidth
            loading={loading}
            disabled={sentTo ? !canVerify : !canSend}
            onPress={() => void (sentTo ? verify() : sendCode())}
            style={{ marginTop: theme.spacing.lg }}
          />

          {sentTo ? (
            <View style={{ marginTop: theme.spacing.md, gap: theme.spacing.sm }}>
              <Pressable onPress={() => void sendCode()} disabled={cooldown > 0}>
                <Text
                  variant="label"
                  tone={cooldown > 0 ? 'muted' : 'brand'}
                  align="center"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send another code'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setSentTo(null);
                  setCode('');
                  setNotice(null);
                }}
              >
                <Text variant="label" tone="secondary" align="center">
                  Use a different number
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text
              variant="caption"
              tone="muted"
              style={{ marginTop: theme.spacing.md, textAlign: 'center' }}
            >
              Include your country code, for example +92 for Pakistan.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
