import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { useTheme, useThemeMode } from '../theme';
import { MainTabs } from './MainTabs';
import { useSession } from '../store/SessionState';
import type { RootStackParamList } from './types';

// Auth
import { SplashScreen } from '../screens/auth/SplashScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignupScreen } from '../screens/auth/SignupScreen';
import { OtpScreen } from '../screens/auth/OtpScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';

// Feed and discovery
import { VideoPlayerScreen } from '../screens/feed/VideoPlayerScreen';
import { SearchScreen } from '../screens/discover/SearchScreen';
import { CategoriesScreen, CategoryFeedScreen } from '../screens/discover/CategoriesScreen';
import { HashtagScreen, SoundDetailScreen } from '../screens/discover/HashtagScreen';

// Creation
import { RecordScreen } from '../screens/create/RecordScreen';
import { UploadScreen } from '../screens/create/UploadScreen';
import { EditorScreen } from '../screens/create/EditorScreen';
import { FiltersScreen } from '../screens/create/FiltersScreen';
import { EffectsScreen } from '../screens/create/EffectsScreen';
import { AdjustScreen } from '../screens/create/AdjustScreen';
import { TextOnVideoScreen } from '../screens/create/TextOnVideoScreen';
import { StickersScreen } from '../screens/create/StickersScreen';
import { MusicScreen } from '../screens/create/MusicScreen';
import { VoiceoverScreen } from '../screens/create/VoiceoverScreen';
import { CoverPickerScreen } from '../screens/create/CoverPickerScreen';
import { CaptionEditorScreen } from '../screens/create/CaptionEditorScreen';
import { PostSettingsScreen } from '../screens/create/PostSettingsScreen';
import { DraftsScreen } from '../screens/create/DraftsScreen';

// Profile and social
import { ProfileScreen } from '../screens/profile/ProfileScreen';
import { EditProfileScreen } from '../screens/profile/EditProfileScreen';
import { FollowersScreen, FollowingScreen } from '../screens/profile/ConnectionsScreen';

// Messaging
import { PrivateChatScreen } from '../screens/chat/PrivateChatScreen';
import { GroupChatScreen } from '../screens/chat/GroupChatScreen';
import { GroupInfoScreen } from '../screens/chat/GroupInfoScreen';
import { CommunityScreen } from '../screens/chat/CommunityScreen';
import { CommunityInfoScreen } from '../screens/chat/CommunityInfoScreen';
import { CommunityRequestsScreen } from '../screens/chat/CommunityRequestsScreen';
import { CommunitiesScreen } from '../screens/chat/CommunitiesScreen';

// Calls
import { VoiceCallScreen, VideoCallScreen, GroupCallScreen } from '../screens/calls/CallScreens';
import { CallHistoryScreen } from '../screens/calls/CallHistoryScreen';

// Live
import { LiveListScreen } from '../screens/live/LiveListScreen';
import { LiveSetupScreen } from '../screens/live/LiveSetupScreen';
import { LiveBroadcastScreen } from '../screens/live/LiveBroadcastScreen';
import { LiveViewerScreen } from '../screens/live/LiveViewerScreen';

// Money
import { WalletScreen } from '../screens/money/WalletScreen';
import { BuyCoinsScreen } from '../screens/money/BuyCoinsScreen';
import { MonetizationScreen } from '../screens/money/MonetizationScreen';
import { DailyTasksScreen } from '../screens/money/DailyTasksScreen';
import { ReferralScreen } from '../screens/money/ReferralScreen';
import { LiveEarningsScreen } from '../screens/money/LiveEarningsScreen';
import { WithdrawScreen } from '../screens/money/WithdrawScreen';
import { TransactionsScreen } from '../screens/money/TransactionsScreen';
import { PromotionScreen } from '../screens/money/PromotionScreen';
import { AdsScreen } from '../screens/money/AdsScreen';
import { CampaignBuilderScreen } from '../screens/money/CampaignBuilderScreen';
import { CreatorDashboardScreen } from '../screens/money/CreatorDashboardScreen';
import { BusinessAnalyticsScreen } from '../screens/money/BusinessAnalyticsScreen';

// Account
import { VerificationScreen } from '../screens/account/VerificationScreen';
import { SettingsScreen } from '../screens/account/SettingsScreen';
import { PrivacyScreen } from '../screens/account/PrivacyScreen';
import { LoginActivityScreen, ChangePasswordScreen } from '../screens/account/SecurityScreens';
import { NotificationSettingsScreen } from '../screens/account/NotificationSettingsScreen';
import { BlockedUsersScreen } from '../screens/account/BlockedUsersScreen';
import { ReportsScreen } from '../screens/account/ReportsScreen';
import { SupportScreen, NewTicketScreen } from '../screens/account/SupportScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const theme = useTheme();
  const { scheme } = useThemeMode();
  const { isSignedIn, backendStatus } = useSession();

  /**
   * Where the app opens.
   *
   * A restored session goes straight to the feed — sending a signed-in user
   * through onboarding again is the kind of small insult that makes an app feel
   * broken. While the session is still being checked the splash screen holds,
   * so the user never sees a flash of the wrong screen.
   */
  const initialRoute = backendStatus === 'checking' ? 'Splash' : isSignedIn ? 'MainTabs' : 'Splash';

  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
      background: theme.colors.bg,
      card: theme.colors.bg,
      text: theme.colors.text,
      border: theme.colors.border,
      primary: theme.colors.brand,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        // Keyed so a sign-in or sign-out rebuilds the stack at the right place
        // rather than leaving the previous session's history behind.
        key={initialRoute}
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
          animation: 'slide_from_right',
        }}
      >
        {/* Auth */}
        <Stack.Group screenOptions={{ animation: 'fade' }}>
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        </Stack.Group>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Signup" component={SignupScreen} />
        <Stack.Screen name="Otp" component={OtpScreen} />
        <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />

        {/* Shell */}
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ animation: 'fade' }} />

        {/* Feed and discovery */}
        <Stack.Screen name="VideoPlayer" component={VideoPlayerScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Search" component={SearchScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Categories" component={CategoriesScreen} />
        <Stack.Screen name="CategoryFeed" component={CategoryFeedScreen} />
        <Stack.Screen name="Hashtag" component={HashtagScreen} />
        <Stack.Screen name="SoundDetail" component={SoundDetailScreen} />

        {/* Creation — presented as a modal flow */}
        <Stack.Group screenOptions={{ animation: 'slide_from_bottom' }}>
          <Stack.Screen name="Record" component={RecordScreen} />
          <Stack.Screen name="Upload" component={UploadScreen} />
          <Stack.Screen name="Drafts" component={DraftsScreen} />
        </Stack.Group>
        <Stack.Screen name="Editor" component={EditorScreen} />
        <Stack.Screen name="Filters" component={FiltersScreen} />
        <Stack.Screen name="Effects" component={EffectsScreen} />
        <Stack.Screen name="Adjust" component={AdjustScreen} />
        <Stack.Screen name="TextOnVideo" component={TextOnVideoScreen} />
        <Stack.Screen name="Stickers" component={StickersScreen} />
        <Stack.Screen name="Music" component={MusicScreen} />
        <Stack.Screen name="Voiceover" component={VoiceoverScreen} />
        <Stack.Screen name="CoverPicker" component={CoverPickerScreen} />
        <Stack.Screen name="CaptionEditor" component={CaptionEditorScreen} />
        <Stack.Screen name="PostSettings" component={PostSettingsScreen} />

        {/* Profile */}
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="EditProfile" component={EditProfileScreen} />
        <Stack.Screen name="Followers" component={FollowersScreen} />
        <Stack.Screen name="Following" component={FollowingScreen} />

        {/* Messaging */}
        <Stack.Screen name="PrivateChat" component={PrivateChatScreen} />
        <Stack.Screen name="GroupChat" component={GroupChatScreen} />
        <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
        <Stack.Screen name="Communities" component={CommunitiesScreen} />
        <Stack.Screen name="Community" component={CommunityScreen} />
        <Stack.Screen name="CommunityInfo" component={CommunityInfoScreen} />
        <Stack.Screen name="CommunityRequests" component={CommunityRequestsScreen} />

        {/* Calls — full screen, no back animation */}
        <Stack.Group screenOptions={{ animation: 'slide_from_bottom', gestureEnabled: false }}>
          <Stack.Screen name="VoiceCall" component={VoiceCallScreen} />
          <Stack.Screen name="VideoCall" component={VideoCallScreen} />
          <Stack.Screen name="GroupCall" component={GroupCallScreen} />
        </Stack.Group>
        <Stack.Screen name="CallHistory" component={CallHistoryScreen} />

        {/* Live */}
        <Stack.Screen name="LiveList" component={LiveListScreen} />
        <Stack.Screen name="LiveSetup" component={LiveSetupScreen} />
        <Stack.Group screenOptions={{ animation: 'fade', gestureEnabled: false }}>
          <Stack.Screen name="LiveBroadcast" component={LiveBroadcastScreen} />
          <Stack.Screen name="LiveViewer" component={LiveViewerScreen} />
        </Stack.Group>

        {/* Money */}
        <Stack.Screen name="Wallet" component={WalletScreen} />
        <Stack.Screen name="BuyCoins" component={BuyCoinsScreen} />
        <Stack.Screen name="Transactions" component={TransactionsScreen} />
        <Stack.Screen name="Monetization" component={MonetizationScreen} />
        <Stack.Screen name="DailyTasks" component={DailyTasksScreen} />
        <Stack.Screen name="Referral" component={ReferralScreen} />
        <Stack.Screen name="LiveEarnings" component={LiveEarningsScreen} />
        <Stack.Screen name="Withdraw" component={WithdrawScreen} />
        <Stack.Screen name="Promotion" component={PromotionScreen} />
        <Stack.Screen name="Ads" component={AdsScreen} />
        <Stack.Screen name="CampaignBuilder" component={CampaignBuilderScreen} />
        <Stack.Screen name="CreatorDashboard" component={CreatorDashboardScreen} />
        <Stack.Screen name="BusinessAnalytics" component={BusinessAnalyticsScreen} />

        {/* Account */}
        <Stack.Screen name="Verification" component={VerificationScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
        <Stack.Screen name="LoginActivity" component={LoginActivityScreen} />
        <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
        <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
        <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
        <Stack.Screen name="Reports" component={ReportsScreen} />
        <Stack.Screen name="Support" component={SupportScreen} />
        <Stack.Screen name="NewTicket" component={NewTicketScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
