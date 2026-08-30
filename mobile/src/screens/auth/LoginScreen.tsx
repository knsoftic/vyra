import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Input, Button, Pressable } from '../../components';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import type { RootScreenProps } from '../../navigation/types';

export function LoginScreen({ navigation }: RootScreenProps<'Login'>) {
  const theme = useTheme();
  const { signIn: signInLocal } = useApp();
  const { signIn, loading, error, backendStatus } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    try {
      await signIn(email.trim(), password);
      // Keeps the Phase 1 local flags in step until every screen reads the
      // session directly.
      signInLocal();
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch {
      // The message is already on the session; nothing to add here.
    }
  };

  const disabled = email.trim().length === 0 || password.length === 0;

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
          <Text variant="h1">Welcome back</Text>
          <Text variant="body" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
            Sign in to pick up where you left off.
          </Text>

          <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.xl }}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              icon="mail-outline"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              icon="lock-closed-outline"
              placeholder="Your password"
              secureTextEntry
            />
          </View>

          <Pressable
            onPress={() => navigation.navigate('ForgotPassword')}
            style={{ alignSelf: 'flex-end', marginTop: theme.spacing.sm }}
          >
            <Text variant="label" tone="brand">
              Forgot password?
            </Text>
          </Pressable>

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
            label="Log in"
            variant="gradient"
            size="lg"
            fullWidth
            loading={loading}
            disabled={disabled}
            onPress={() => void handleLogin()}
            style={{ marginTop: theme.spacing.lg }}
          />

          <View style={[styles.dividerRow, { marginVertical: theme.spacing.xl }]}>
            <View style={[styles.line, { backgroundColor: theme.colors.border }]} />
            <Text variant="caption" tone="muted">
              OR CONTINUE WITH
            </Text>
            <View style={[styles.line, { backgroundColor: theme.colors.border }]} />
          </View>

          <View style={{ gap: theme.spacing.sm }}>
            {[
              { id: 'apple', label: 'Continue with Apple', icon: 'logo-apple' as const },
              { id: 'google', label: 'Continue with Google', icon: 'logo-google' as const },
              { id: 'phone', label: 'Continue with phone', icon: 'call-outline' as const },
            ].map((provider) => (
              <Button
                key={provider.id}
                label={provider.label}
                variant="outline"
                size="lg"
                fullWidth
                icon={provider.icon}
                // Phone sign-in is built; Apple and Google are not, and a button
                // that silently does nothing is worse than one that is plainly
                // unavailable.
                disabled={provider.id !== 'phone'}
                {...(provider.id === 'phone'
                  ? { onPress: () => navigation.navigate('PhoneLogin') }
                  : {})}
              />
            ))}
          </View>

          <View style={[styles.footer, { marginTop: theme.spacing.xl }]}>
            <Text variant="label" tone="secondary">
              New here?
            </Text>
            <Pressable onPress={() => navigation.navigate('Signup')}>
              <Text variant="labelStrong" tone="brand">
                Create an account
              </Text>
            </Pressable>
          </View>

          <View style={[styles.legal, { marginTop: theme.spacing.xl }]}>
            <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
            <Text variant="caption" tone="muted" style={styles.flex}>
              By continuing you agree to our Terms and Privacy Policy. We never use your
              microphone outside recording, calls and live streaming.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  legal: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
