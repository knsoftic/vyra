import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Avatar,
  Input,
  Button,
  Card,
  ListRow,
  Divider,
  Badge,
} from '../../components';
import { SourceTag } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { useApp } from '../../store/AppState';
import { useSession } from '../../store/SessionState';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { me as meApi, ApiError } from '../../api';
import type { RootScreenProps } from '../../navigation/types';

/** People type "site.com"; the server requires a real URL. */
function normaliseUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function EditProfileScreen({ navigation }: RootScreenProps<'EditProfile'>) {
  const theme = useTheme();
  const { setUser } = useApp();
  const { user } = useCurrentUser();
  const { user: sessionUser, refreshProfile } = useSession();
  const live = sessionUser !== null;

  // The signed-in profile is the source of truth when there is one.
  const initial = sessionUser
    ? {
        displayName: sessionUser.displayName,
        username: sessionUser.username,
        bio: sessionUser.bio ?? '',
        website: sessionUser.links?.[0]?.url ?? '',
      }
    : {
        displayName: user.displayName,
        username: user.username,
        bio: user.bio ?? '',
        website: user.website ?? '',
      };

  const [displayName, setDisplayName] = useState(initial.displayName);
  const [username, setUsername] = useState(initial.username);
  const [bio, setBio] = useState(initial.bio);
  const [website, setWebsite] = useState(initial.website);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBusiness = (sessionUser?.accountCategory ?? user.accountCategory) === 'business';

  const save = async () => {
    setSaving(true);
    setError(null);

    if (live) {
      try {
        // Only the fields the server actually accepts are sent. A website is
        // stored as the first profile link; an empty box clears the list rather
        // than leaving a stale URL behind.
        await meApi.update({
          displayName: displayName.trim(),
          bio: bio.trim(),
          links: website.trim() ? [{ label: 'Website', url: normaliseUrl(website.trim()) }] : [],
        });
        await refreshProfile();
        setSaving(false);
        navigation.goBack();
      } catch (err) {
        setSaving(false);
        setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
      }
      return;
    }

    // No backend: the edit lives in local state so the UI stays usable.
    setUser({ ...user, displayName, username, bio, website: website || undefined });
    setSaving(false);
    navigation.goBack();
  };

  return (
    <Screen>
      <Header
        title="Edit profile"
        right={
          <Pressable onPress={() => void save()} hitSlop={theme.layout.hitSlop}>
            <Text variant="labelStrong" tone="brand">
              Save
            </Text>
          </Pressable>
        }
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Avatar */}
          <View style={[styles.avatarSection, { paddingVertical: theme.spacing.lg }]}>
            <Pressable style={styles.avatarWrap}>
              <Avatar uri={user.avatar} size={96} />
              <View style={[styles.avatarEdit, { backgroundColor: theme.colors.brand, borderColor: theme.colors.bg }]}>
                <Ionicons name="camera" size={14} color="#FFF" />
              </View>
            </Pressable>
            <Pressable>
              <Text variant="label" tone="brand">
                Change photo
              </Text>
            </Pressable>
          </View>

          <View style={{ alignItems: 'center', paddingBottom: theme.spacing.sm }}>
            <SourceTag source={live ? 'live' : 'sample'} noun="profile" />
          </View>

          {error ? (
            <Text variant="caption" tone="danger" style={{ paddingHorizontal: theme.spacing.md }}>
              {error}
            </Text>
          ) : null}

          {/* Fields */}
          <View style={{ paddingHorizontal: theme.spacing.md, gap: theme.spacing.md }}>
            <Input label="Name" value={displayName} onChangeText={setDisplayName} maxLength={60} showCounter />
            <Input
              label="Username"
              value={username}
              onChangeText={setUsername}
              icon="at-outline"
              autoCapitalize="none"
              editable={!live}
              hint={
                live
                  ? 'Username changes are not available yet — your handle stays as it is.'
                  : 'Changing your username changes your profile link.'
              }
            />
            <Input
              label="Bio"
              value={bio}
              onChangeText={setBio}
              multiline
              maxLength={500}
              showCounter
              placeholder="Tell people what you make"
            />
            <Input
              label="Website"
              value={website}
              onChangeText={setWebsite}
              icon="link-outline"
              autoCapitalize="none"
              placeholder="yoursite.com"
            />
          </View>

          {/* Business fields */}
          {isBusiness ? (
            <>
              <Text
                variant="labelStrong"
                tone="muted"
                style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
              >
                BUSINESS INFORMATION
              </Text>
              <Card style={{ marginTop: theme.spacing.xs }}>
                <ListRow label="Business category" value={user.businessCategory} onPress={() => {}} />
                <Divider inset={16} />
                <ListRow label="Contact email" value={user.contactEmail} onPress={() => {}} />
                <Divider inset={16} />
                <ListRow label="Contact phone" value={user.contactPhone} onPress={() => {}} />
                <Divider inset={16} />
                <ListRow
                  label="Call-to-action button"
                  value={user.cta?.label ?? 'None'}
                  onPress={() => {}}
                />
              </Card>
            </>
          ) : null}

          {/* Account */}
          <Text
            variant="labelStrong"
            tone="muted"
            style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
          >
            ACCOUNT
          </Text>
          <Card style={{ marginTop: theme.spacing.xs }}>
            <ListRow
              label="Account type"
              value={user.accountType.replace('_', ' ')}
              description="Switching type never removes your content, followers or wallet"
              onPress={() => {}}
            />
            <Divider inset={16} />
            <ListRow
              label="Verification"
              icon="checkmark-circle-outline"
              right={
                user.verification !== 'none' ? (
                  <Badge label="Verified" tone="accent" size="sm" />
                ) : (
                  <Badge label="Not verified" tone="neutral" size="sm" />
                )
              }
              onPress={() => navigation.navigate('Verification')}
            />
          </Card>

          <View style={{ padding: theme.spacing.md }}>
            <Button
              label="Save changes"
              variant="gradient"
              fullWidth
              loading={saving}
              onPress={() => void save()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  avatarSection: { alignItems: 'center', gap: 10 },
  avatarWrap: {},
  avatarEdit: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
