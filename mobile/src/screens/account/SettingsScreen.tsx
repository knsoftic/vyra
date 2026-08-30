import React from 'react';
import { View, StyleSheet, ScrollView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Avatar,
  NameWithBadge,
  Card,
  ListRow,
  Divider,
  SectionHeader,
  Segmented,
  Badge,
  Pressable,
} from '../../components';
import { useTheme, useThemeMode } from '../../theme';
import { appInfo } from '../../mock';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import type { RootScreenProps } from '../../navigation/types';

export function SettingsScreen({ navigation }: RootScreenProps<'Settings'>) {
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();
  const { signOut } = useApp();
  // The account this page is about is the signed-in one, not the sample.
  const { user } = useCurrentUser();
  // Signing out has to end the server session too, or the device stays
  // authorised and "sign out" is a lie.
  const { signOut: signOutServer } = useSession();

  const open = (url: string) => Linking.openURL(url).catch(() => {});

  return (
    <Screen>
      <Header title="Settings and privacy" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Account header */}
        <Pressable
          onPress={() => navigation.navigate('EditProfile')}
          style={[
            styles.accountRow,
            {
              backgroundColor: theme.colors.surface,
              margin: theme.spacing.md,
              borderRadius: theme.radius.lg,
              padding: theme.spacing.md,
            },
          ]}
        >
          <Avatar uri={user.avatar} size={52} />
          <View style={styles.flex}>
            <NameWithBadge name={user.displayName} tier={user.verification} />
            <Text variant="caption" tone="muted">
              @{user.username} · {user.accountType.replace('_', ' ')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </Pressable>

        {/* Account */}
        <SectionHeader title="Account" />
        <Card>
          <ListRow label="Edit profile" icon="person-outline" onPress={() => navigation.navigate('EditProfile')} />
          <Divider inset={60} />
          <ListRow
            label="Verification"
            icon="checkmark-circle-outline"
            right={
              user.verification !== 'none' ? <Badge label="Verified" tone="accent" size="sm" /> : null
            }
            onPress={() => navigation.navigate('Verification')}
          />
          <Divider inset={60} />
          <ListRow label="Wallet and coins" icon="wallet-outline" onPress={() => navigation.navigate('Wallet')} />
          <Divider inset={60} />
          <ListRow
            label="Monetization"
            icon="ribbon-outline"
            onPress={() => navigation.navigate('Monetization')}
          />
          <Divider inset={60} />
          <ListRow
            label="Daily tasks and rewards"
            icon="checkbox-outline"
            onPress={() => navigation.navigate('DailyTasks')}
          />
          <Divider inset={60} />
          <ListRow
            label="Creator dashboard"
            icon="stats-chart-outline"
            onPress={() => navigation.navigate('CreatorDashboard')}
          />
          <Divider inset={60} />
          <ListRow
            label="Business analytics"
            icon="business-outline"
            onPress={() => navigation.navigate('BusinessAnalytics')}
          />
          <Divider inset={60} />
          <ListRow label="Advertising" icon="megaphone-outline" onPress={() => navigation.navigate('Ads')} />
        </Card>

        {/* Content and activity */}
        <SectionHeader title="Content and activity" />
        <Card>
          <ListRow label="Drafts" icon="document-outline" onPress={() => navigation.navigate('Drafts')} />
          <Divider inset={60} />
          <ListRow label="Saved videos" icon="bookmark-outline" onPress={() => navigation.navigate('MainTabs')} />
          <Divider inset={60} />
          <ListRow label="Your reports" icon="flag-outline" onPress={() => navigation.navigate('Reports')} />
          <Divider inset={60} />
          <ListRow
            label="Watch history"
            description="What you watched, used only to improve your feed"
            icon="time-outline"
            onPress={() => {}}
          />
        </Card>

        {/* Privacy */}
        <SectionHeader title="Privacy and safety" />
        <Card>
          <ListRow label="Privacy" icon="lock-closed-outline" onPress={() => navigation.navigate('Privacy')} />
          <Divider inset={60} />
          <ListRow label="Blocked users" icon="ban-outline" onPress={() => navigation.navigate('BlockedUsers')} />
          <Divider inset={60} />
          <ListRow
            label="Notifications"
            icon="notifications-outline"
            onPress={() => navigation.navigate('NotificationSettings')}
          />
          <Divider inset={60} />
          <ListRow
            label="Login activity"
            description="Devices and sessions signed in to your account"
            icon="phone-portrait-outline"
            onPress={() => navigation.navigate('LoginActivity')}
          />
          <Divider inset={60} />
          <ListRow
            label="Change password"
            icon="key-outline"
            onPress={() => navigation.navigate('ChangePassword')}
          />
        </Card>

        {/* Display */}
        <SectionHeader title="Display" />
        <Card padded>
          <Text variant="label" tone="secondary" style={{ marginBottom: theme.spacing.xs }}>
            Appearance
          </Text>
          <Segmented
            options={[
              { id: 'dark', label: 'Dark' },
              { id: 'light', label: 'Light' },
              { id: 'system', label: 'System' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Text variant="caption" tone="muted" style={{ marginTop: theme.spacing.sm }}>
            The video feed always stays dark so content sits edge to edge.
          </Text>
        </Card>

        <Card style={{ marginTop: theme.spacing.sm }}>
          <ListRow label="Language" icon="language-outline" value="English" onPress={() => {}} />
          <Divider inset={60} />
          <ListRow label="Data saver" description="Lower video quality on mobile data" icon="cellular-outline" onPress={() => {}} />
          <Divider inset={60} />
          <ListRow label="Playback settings" icon="play-circle-outline" onPress={() => {}} />
        </Card>

        {/* Support */}
        <SectionHeader title="Support and about" />
        <Card>
          <ListRow label="Help and support" icon="help-circle-outline" onPress={() => navigation.navigate('Support')} />
          <Divider inset={60} />
          <ListRow
            label="Community guidelines"
            icon="book-outline"
            onPress={() => open(appInfo.guidelinesUrl)}
          />
          <Divider inset={60} />
          <ListRow label="Terms of service" icon="document-text-outline" onPress={() => open(appInfo.termsUrl)} />
          <Divider inset={60} />
          <ListRow label="Privacy policy" icon="shield-outline" onPress={() => open(appInfo.privacyPolicyUrl)} />
          <Divider inset={60} />
          <ListRow
            label="App version"
            icon="information-circle-outline"
            value={`${appInfo.version} (${appInfo.build})`}
            showChevron={false}
          />
        </Card>

        {/* Session */}
        <Card style={{ marginTop: theme.spacing.lg }}>
          <ListRow
            label="Log out"
            icon="log-out-outline"
            danger
            onPress={() => {
              void signOutServer();
              signOut();
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            }}
          />
        </Card>

        <Card style={{ marginTop: theme.spacing.sm }}>
          <ListRow
            label="Delete account"
            description="Your videos, messages and wallet history are removed after a 30-day grace period"
            icon="trash-outline"
            danger
            onPress={() => {}}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
