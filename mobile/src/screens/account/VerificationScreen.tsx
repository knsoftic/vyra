import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Screen,
  Header,
  Text,
  Pressable,
  Button,
  Card,
  Badge,
  Divider,
  ListRow,
  Avatar,
  VerifiedBadge,
} from '../../components';
import { useTheme } from '../../theme';
import { verificationTiers, verificationRequest as sampleRequest } from '../../mock';
import { SourceNote } from '../../components/DataSource';
import { useApiData } from '../../hooks/useApiData';
import { trust, ApiError } from '../../api';
import { formatDate } from '../../utils/format';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import type { RootScreenProps } from '../../navigation/types';

export function VerificationScreen({ navigation }: RootScreenProps<'Verification'>) {
  const theme = useTheme();
  const { user } = useCurrentUser();

  const [selectedTier, setSelectedTier] = useState<string>(
    user.accountCategory === 'business' ? 'business' : 'creator',
  );
  const [submitted, setSubmitted] = useState(false);

  /**
   * The applicant's own requests.
   *
   * Note what is *not* here: no document list, no thumbnails, no keys. The
   * server returns a count and the app has nowhere to put anything more, which
   * is what makes "identity documents are never sent back" a property of the
   * code rather than a promise.
   */
  const { data: requests, source, refresh } = useApiData(
    () => trust.verificationRequests(),
    [],
    [],
    // No applications is a real answer. Falling back would show this account an
    // approved application it never made.
    { fallbackOnEmpty: false },
  );

  const live = source === 'live';
  const latest = requests[0];

  const request = latest
    ? {
        ...sampleRequest,
        status: latest.status,
        submittedAt: latest.createdAt,
        documentCount: latest.documentCount,
        ...(latest.note ? { note: latest.note } : {}),
      }
    : live
      ? // Signed in with no applications. The honest state is "not applied" —
        // showing the sample here would tell this account it holds an approved
        // application it never made.
        { ...sampleRequest, status: 'not_applied' as const, note: undefined }
      : sampleRequest;

  // An open request blocks another; the button says so rather than failing on
  // submit.
  const openRequest = requests.find((r) =>
    ['pending', 'reviewing', 'more_info'].includes(r.status),
  );

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const alreadyVerified = user.verification !== 'none';

  /**
   * Submits the application.
   *
   * Documents are uploaded first and referenced by key; this call sends the
   * keys, never the files. With no upload flow wired on this screen yet the
   * live path is refused rather than pretending — an application with no
   * documents cannot be reviewed.
   */
  const submit = () => {
    if (!live) {
      setSubmitted(true);
      return;
    }
    setSubmitError(
      'Document upload is not available on this screen yet. Verification needs at least one ' +
        'identity document, so an application cannot be sent without one.',
    );
  };
  const tier = verificationTiers.find((t) => t.id === selectedTier) ?? verificationTiers[1];

  const statusMap = {
    approved: { label: 'Approved', tone: 'success' as const, icon: 'checkmark-circle' as const },
    pending: { label: 'In review', tone: 'warning' as const, icon: 'time-outline' as const },
    // The server distinguishes "queued" from "a reviewer has it open", and so
    // does this — an applicant checking back deserves to see it moved.
    reviewing: { label: 'Being reviewed', tone: 'warning' as const, icon: 'eye-outline' as const },
    more_info: { label: 'More info needed', tone: 'warning' as const, icon: 'alert-circle-outline' as const },
    rejected: { label: 'Not approved', tone: 'danger' as const, icon: 'close-circle-outline' as const },
    not_applied: { label: 'Not applied', tone: 'neutral' as const, icon: 'ellipse-outline' as const },
  };

  const status = statusMap[request.status];

  return (
    <Screen>
      <Header title="Verification" />

      <SourceNote
        source={source}
        noun="applications"
        sampleHint="sign in to apply for a badge"
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Current state */}
        <View style={[styles.hero, { padding: theme.spacing.lg }]}>
          <View style={styles.avatarWrap}>
            <Avatar uri={user.avatar} size={80} />
            {alreadyVerified ? (
              <View style={[styles.badgeDot, { backgroundColor: theme.colors.bg }]}>
                <VerifiedBadge tier={user.verification} size={26} />
              </View>
            ) : null}
          </View>

          <Text variant="h3" style={{ marginTop: theme.spacing.sm }}>
            {user.displayName}
          </Text>
          <Text variant="caption" tone="muted">
            @{user.username}
          </Text>

          <View style={{ marginTop: theme.spacing.sm }}>
            <Badge label={status.label} tone={status.tone} />
          </View>
        </View>

        {/* Existing request */}
        {request.status !== 'not_applied' ? (
          <Card padded style={{ gap: theme.spacing.xs }}>
            <View style={styles.requestHeader}>
              <Ionicons name={status.icon} size={18} color={theme.colors[status.tone === 'success' ? 'success' : status.tone === 'danger' ? 'danger' : 'warning']} />
              <Text variant="bodyStrong" style={styles.flex}>
                {tier.label} verification — {status.label}
              </Text>
            </View>
            {request.submittedAt ? (
              <Text variant="caption" tone="muted">
                Submitted {formatDate(request.submittedAt)}
                {request.reviewedAt ? ` · reviewed ${formatDate(request.reviewedAt)}` : ''}
              </Text>
            ) : null}
            {request.note ? (
              <Text variant="label" tone="secondary" style={{ marginTop: theme.spacing.xs }}>
                {request.note}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {/* Tier selection */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          BADGE TYPE
        </Text>
        <View style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs, gap: theme.spacing.xs }}>
          {verificationTiers.map((item) => {
            const active = selectedTier === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setSelectedTier(item.id)}
                style={[
                  styles.tierRow,
                  {
                    backgroundColor: active ? theme.colors.brandSoft : theme.colors.surface,
                    borderColor: active ? theme.colors.brand : 'transparent',
                    borderRadius: theme.radius.md,
                  },
                ]}
              >
                <VerifiedBadge
                  tier={item.id === 'business' ? 'business' : item.id === 'creator' ? 'creator' : 'individual'}
                  size={22}
                />
                <View style={styles.flex}>
                  <Text variant="bodyStrong">{item.label}</Text>
                  <Text variant="caption" tone="muted">
                    {item.description}
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

        {/* Requirements */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          REQUIREMENTS
        </Text>
        <Card style={{ marginTop: theme.spacing.xs }}>
          {tier.requirements.map((requirement, index) => (
            <View key={requirement}>
              {index > 0 ? <Divider inset={48} /> : null}
              <View style={[styles.requirementRow, { padding: theme.spacing.md }]}>
                <Ionicons
                  name={index < 3 ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={index < 3 ? theme.colors.success : theme.colors.textMuted}
                />
                <Text variant="body" style={styles.flex}>
                  {requirement}
                </Text>
              </View>
            </View>
          ))}
        </Card>

        {/* Documents */}
        <Text
          variant="labelStrong"
          tone="muted"
          style={{ paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.lg }}
        >
          DOCUMENTS
        </Text>
        <Card style={{ marginTop: theme.spacing.xs }}>
          <ListRow
            label={selectedTier === 'business' ? 'Business registration' : 'Government-issued ID'}
            description="PDF or photo, under 10 MB"
            icon="document-attach-outline"
            onPress={() => {}}
          />
          <Divider inset={60} />
          <ListRow
            label="Supporting link"
            description="Website, press coverage or official page"
            icon="link-outline"
            onPress={() => {}}
          />
        </Card>

        {/* Privacy note */}
        <Card padded style={{ marginTop: theme.spacing.lg }}>
          <View style={styles.noticeRow}>
            <Ionicons name="lock-closed-outline" size={16} color={theme.colors.info} />
            <Text variant="caption" tone="secondary" style={styles.flex}>
              Documents are used only to confirm your identity, are visible only to the
              verification team, and are never shown on your profile.
            </Text>
          </View>
        </Card>

        <View style={{ padding: theme.spacing.md }}>
          <Button
            label={submitted ? 'Application submitted' : alreadyVerified ? 'Apply for another badge' : 'Submit application'}
            variant="gradient"
            fullWidth
            size="lg"
            disabled={submitted || submitting || openRequest !== undefined}
            loading={submitting}
            onPress={submit}
          />
          {submitError ? (
            <Text variant="caption" tone="danger" align="center" style={{ marginTop: theme.spacing.sm }}>
              {submitError}
            </Text>
          ) : null}
          {openRequest ? (
            <Text variant="caption" tone="muted" align="center" style={{ marginTop: theme.spacing.sm }}>
              You already have an application being reviewed.
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" align="center" style={{ marginTop: theme.spacing.sm }}>
            Reviews usually take 3 to 7 days. You will get a notification either way.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { alignItems: 'center' },
  avatarWrap: {},
  badgeDot: { position: 'absolute', right: -2, bottom: -2, borderRadius: 15, padding: 2 },
  requestHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1.5 },
  requirementRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
