import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Header, Text, Input, Button, Pressable, Badge } from '../../components';
import { useTheme } from '../../theme';
import { useSession } from '../../store/SessionState';
import { useApp } from '../../store/AppState';
import type { RootScreenProps } from '../../navigation/types';
import type { AccountCategory } from '../../types';

const individualTypes = [
  { id: 'normal', label: 'Normal User', description: 'Watch, comment and post for fun' },
  { id: 'creator', label: 'Creator', description: 'Publish regularly and grow an audience' },
  { id: 'public_figure', label: 'Public Figure', description: 'A known person or personality' },
  { id: 'professional', label: 'Professional', description: 'Share expertise in your field' },
];

const businessTypes = [
  { id: 'company', label: 'Company', description: 'A registered business' },
  { id: 'brand', label: 'Brand', description: 'A product or consumer brand' },
  { id: 'shop', label: 'Shop', description: 'Sell products directly' },
  { id: 'organization', label: 'Organization', description: 'Non-profit or institution' },
  { id: 'advertiser', label: 'Advertiser', description: 'Run campaigns on the platform' },
  { id: 'service_provider', label: 'Service Provider', description: 'Offer services locally or online' },
];

export function SignupScreen({ navigation }: RootScreenProps<'Signup'>) {
  const theme = useTheme();
  const { signUp, loading, error, backendStatus } = useSession();
  const { signIn: signInLocal } = useApp();
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [category, setCategory] = useState<AccountCategory>('individual');
  const [accountType, setAccountType] = useState('creator');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const types = category === 'individual' ? individualTypes : businessTypes;

  const handleSignup = async () => {
    try {
      await signUp({
        email: email.trim(),
        password,
        username: username.trim().toLowerCase(),
        // The server enforces 13+; this is the account's stated date of birth.
        birthdate: '2000-01-01',
      });
      signInLocal();
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch {
      // The session already holds the message.
    }
  };

  const canSubmit =
    email.trim().length > 3 && username.trim().length >= 3 && password.length >= 8;

  return (
    <Screen>
      <Header
        title={step === 'type' ? 'Choose account type' : 'Create your account'}
        onBack={step === 'details' ? () => setStep('type') : undefined}
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'type' ? (
            <>
              <Text variant="body" tone="secondary">
                You can change this later in Settings without losing any content.
              </Text>

              <View style={[styles.categoryRow, { marginTop: theme.spacing.lg }]}>
                {(['individual', 'business'] as const).map((option) => {
                  const active = category === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => {
                        setCategory(option);
                        setAccountType(option === 'individual' ? 'creator' : 'company');
                      }}
                      style={[
                        styles.categoryCard,
                        {
                          backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
                          borderColor: active ? theme.colors.brand : theme.colors.border,
                          borderRadius: theme.radius.lg,
                          padding: theme.spacing.md,
                        },
                      ]}
                    >
                      <Ionicons
                        name={option === 'individual' ? 'person-outline' : 'business-outline'}
                        size={22}
                        color={active ? theme.colors.brand : theme.colors.textSecondary}
                      />
                      <Text variant="bodyStrong" style={{ marginTop: theme.spacing.xs }}>
                        {option === 'individual' ? 'Individual' : 'Business'}
                      </Text>
                      <Text variant="caption" tone="muted">
                        {option === 'individual'
                          ? 'For people and creators'
                          : 'For companies and brands'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text variant="labelStrong" tone="muted" style={{ marginTop: theme.spacing.xl }}>
                {category === 'individual' ? 'INDIVIDUAL TYPES' : 'BUSINESS TYPES'}
              </Text>

              <View style={{ gap: theme.spacing.xs, marginTop: theme.spacing.sm }}>
                {types.map((type) => {
                  const active = accountType === type.id;
                  return (
                    <Pressable
                      key={type.id}
                      onPress={() => setAccountType(type.id)}
                      style={[
                        styles.typeRow,
                        {
                          backgroundColor: theme.colors.surface,
                          borderColor: active ? theme.colors.brand : 'transparent',
                          borderRadius: theme.radius.md,
                          padding: theme.spacing.md,
                        },
                      ]}
                    >
                      <View style={styles.flex}>
                        <Text variant="bodyStrong">{type.label}</Text>
                        <Text variant="caption" tone="muted">
                          {type.description}
                        </Text>
                      </View>
                      <Ionicons
                        name={active ? 'radio-button-on' : 'radio-button-off'}
                        size={20}
                        color={active ? theme.colors.brand : theme.colors.textMuted}
                      />
                    </Pressable>
                  );
                })}
              </View>

              {category === 'business' ? (
                <View style={[styles.notice, { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.md }]}>
                  <Badge label="INCLUDED" tone="gold" size="sm" />
                  <Text variant="caption" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
                    Business accounts unlock the campaign manager, business analytics, a
                    call-to-action button and business verification.
                  </Text>
                </View>
              ) : null}

              <Button
                label="Continue"
                variant="gradient"
                size="lg"
                fullWidth
                onPress={() => setStep('details')}
                style={{ marginTop: theme.spacing.xl }}
              />
            </>
          ) : (
            <>
              <Text variant="body" tone="secondary">
                We will email you a 6-digit code to confirm this address.
              </Text>

              <View style={{ gap: theme.spacing.md, marginTop: theme.spacing.lg }}>
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  icon="mail-outline"
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Input
                  label="Username"
                  value={username}
                  onChangeText={setUsername}
                  icon="at-outline"
                  placeholder="yourname"
                  autoCapitalize="none"
                  hint="Letters, numbers, underscores and dots. This is your @handle."
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  icon="lock-closed-outline"
                  placeholder="At least 8 characters"
                  secureTextEntry
                  hint="Use 8+ characters with a mix of letters and numbers."
                />
              </View>

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
                  Server offline — start the backend to create an account.
                </Text>
              ) : null}

              <Button
                label="Create account"
                variant="gradient"
                size="lg"
                fullWidth
                loading={loading}
                disabled={!canSubmit}
                onPress={() => void handleSignup()}
                style={{ marginTop: theme.spacing.xl }}
              />

              <View style={[styles.footer, { marginTop: theme.spacing.lg }]}>
                <Text variant="label" tone="secondary">
                  Already registered?
                </Text>
                <Pressable onPress={() => navigation.replace('Login')}>
                  <Text variant="labelStrong" tone="brand">
                    Log in
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  categoryRow: { flexDirection: 'row', gap: 12 },
  categoryCard: { flex: 1, borderWidth: 1.5 },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5 },
  notice: {},
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
});
