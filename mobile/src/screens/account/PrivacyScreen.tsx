import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Card,
  ListRow,
  Divider,
  Toggle,
  SectionHeader,
  Segmented,
} from '../../components';
import { SourceNote } from '../../components/DataSource';
import { useTheme } from '../../theme';
import { privacySettings, notificationSettings } from '../../mock';
import { useSession } from '../../store/SessionState';
import { account, ApiError, type PrivacySettings } from '../../api';
import type { RootScreenProps } from '../../navigation/types';

/** Shared renderer for the two toggle-list screens. */
export function ToggleSections({
  sections,
  footerNote,
}: {
  sections: {
    section: string;
    items: { id: string; label: string; value: boolean; description?: string }[];
  }[];
  footerNote?: string;
}) {
  const theme = useTheme();
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.flatMap((s) => s.items.map((item) => [item.id, item.value]))),
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
      {sections.map((section) => (
        <View key={section.section}>
          <SectionHeader title={section.section} />
          <Card>
            {section.items.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <ListRow
                  label={item.label}
                  description={item.description}
                  showChevron={false}
                  right={
                    <Toggle
                      value={values[item.id]}
                      onValueChange={(next) => setValues((prev) => ({ ...prev, [item.id]: next }))}
                    />
                  }
                />
              </View>
            ))}
          </Card>
        </View>
      ))}

      {footerNote ? (
        <View style={[styles.note, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }]}>
          <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
          <Text variant="caption" tone="muted" style={styles.flex}>
            {footerNote}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const PRIVACY_FOOTER =
  'We never listen to your microphone outside recording, voice notes, calls and live streaming. ' +
  'Your feed is personalised from what you do in the app, and nothing else.';

const AUDIENCE_OPTIONS: { id: 'everyone' | 'followers' | 'nobody'; label: string }[] = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'followers', label: 'Followers' },
  { id: 'nobody', label: 'No one' },
];

/**
 * The live privacy screen.
 *
 * Audience settings are deliberately *not* toggles here. The server stores three
 * values - everyone, followers, no one - and a two-state switch cannot express
 * the middle one. Rendering "followers" as an ON toggle would mean that turning
 * it off and on again silently widens the audience from followers to everyone,
 * which is a privacy regression the user never asked for.
 *
 * Each change is written immediately and the response is what gets displayed,
 * so the screen always shows the setting the server actually holds.
 */
function LivePrivacy() {
  const theme = useTheme();
  const { user, refreshProfile } = useSession();

  const [settings, setSettings] = useState<PrivacySettings>({
    isPrivate: user?.privacy.isPrivate ?? false,
    whoCanComment: user?.privacy.whoCanComment ?? 'everyone',
    whoCanMessage: user?.privacy.whoCanMessage ?? 'everyone',
    whoCanDuet: user?.privacy.whoCanDuet ?? 'everyone',
    whoCanMention: user?.privacy.whoCanMention ?? 'everyone',
    allowDownload: user?.privacy.allowDownload ?? true,
    suggestAccount: user?.privacy.suggestAccount ?? true,
    allowRemix: user?.privacy.allowRemix ?? true,
    personalisedAds: user?.privacy.personalisedAds ?? true,
    showActivityStatus: user?.privacy.showActivityStatus ?? true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The profile is the authority; re-sync whenever it changes underneath us.
  useEffect(() => {
    if (!user) return;
    setSettings({ ...user.privacy });
  }, [user]);

  const apply = async (patch: Partial<PrivacySettings>, key: string) => {
    const previous = settings;
    setSettings((prev) => ({ ...prev, ...patch }));
    setBusy(key);
    setError(null);
    try {
      const saved = await account.privacy(patch);
      setSettings(saved);
      await refreshProfile();
    } catch (err) {
      // Roll back rather than leave the switch showing a setting that was
      // never stored.
      setSettings(previous);
      setError(err instanceof ApiError ? err.message : 'Could not save that setting.');
    } finally {
      setBusy(null);
    }
  };

  const switchRow = (
    key: 'isPrivate' | 'allowDownload' | 'suggestAccount' | 'allowRemix' | 'personalisedAds' | 'showActivityStatus',
    label: string,
    description: string,
  ) => (
    <ListRow
      label={label}
      description={description}
      showChevron={false}
      right={
        busy === key ? (
          <ActivityIndicator size="small" color={theme.colors.brand} />
        ) : (
          <Toggle
            value={settings[key]}
            onValueChange={(next) => void apply({ [key]: next }, key)}
          />
        )
      }
    />
  );

  const audienceRow = (
    key: 'whoCanComment' | 'whoCanMessage' | 'whoCanDuet' | 'whoCanMention',
    label: string,
    description: string,
  ) => (
    <View style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }}>
      <Text variant="body">{label}</Text>
      <Text variant="caption" tone="muted" style={{ marginBottom: theme.spacing.xs }}>
        {description}
      </Text>
      <Segmented
        options={AUDIENCE_OPTIONS}
        value={settings[key]}
        onChange={(next) => void apply({ [key]: next }, key)}
      />
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
      <SourceNote
        source="live"
        noun="privacy settings"
        liveHint="changes are saved to your account straight away"
      />

      {error ? (
        <Text variant="caption" tone="danger" style={{ paddingHorizontal: theme.spacing.md }}>
          {error}
        </Text>
      ) : null}

      <SectionHeader title="Account privacy" />
      <Card>
        {switchRow('isPrivate', 'Private account', 'Only approved followers can see your videos')}
        <Divider inset={16} />
        {switchRow(
          'suggestAccount',
          'Suggest your account to others',
          'Whether you appear in other people\u2019s suggestions',
        )}
        <Divider inset={16} />
        {switchRow(
          'showActivityStatus',
          'Show activity status',
          'Lets people see when you were last active',
        )}
      </Card>

      <SectionHeader title="Interactions" />
      <Card>
        {audienceRow('whoCanComment', 'Who can comment', 'Applies to every video you post')}
        <Divider inset={16} />
        {audienceRow('whoCanMessage', 'Who can message you', 'Direct messages from other accounts')}
        <Divider inset={16} />
        {audienceRow('whoCanDuet', 'Who can Duet with you', 'Duets of your videos')}
        <Divider inset={16} />
        {audienceRow('whoCanMention', 'Who can mention you', 'Being tagged in captions and comments')}
        <Divider inset={16} />
        {switchRow('allowRemix', 'Allow Remix', 'The starting setting for each new video you post')}
        <Divider inset={16} />
        {switchRow(
          'allowDownload',
          'Allow downloads',
          'Lets viewers save your videos to their device',
        )}
      </Card>

      <SectionHeader title="Data" />
      <Card>
        {switchRow(
          'personalisedAds',
          'Personalised ads',
          'Off means advertisers can still reach you by country and category \u2014 never by what you watched',
        )}
      </Card>

      <View style={[styles.note, { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }]}>
        <Ionicons name="shield-checkmark-outline" size={14} color={theme.colors.textMuted} />
        <Text variant="caption" tone="muted" style={styles.flex}>
          {PRIVACY_FOOTER}
        </Text>
      </View>
    </ScrollView>
  );
}

export function PrivacyScreen({}: RootScreenProps<'Privacy'>) {
  const { backendStatus, isSignedIn } = useSession();
  const live = backendStatus === 'live' && isSignedIn;

  return (
    <Screen>
      <Header title="Privacy" />
      {live ? (
        <LivePrivacy />
      ) : (
        <>
          <SourceNote
            source="sample"
            noun="privacy settings"
            sampleHint="sign in to change the settings on your account"
          />
          <ToggleSections sections={privacySettings} footerNote={PRIVACY_FOOTER} />
        </>
      )}
    </Screen>
  );
}


const styles = StyleSheet.create({
  flex: { flex: 1 },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
});
