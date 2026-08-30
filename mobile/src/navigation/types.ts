import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

/**
 * Full navigation graph. Every screen in PHASE_01_UI_UX.md appears here, so an
 * unreachable screen is a type error rather than a silent gap.
 */
export type RootStackParamList = {
  // Auth
  Splash: undefined;
  Onboarding: undefined;
  Login: undefined;
  Signup: undefined;
  Otp: { email: string; purpose: 'signup' | 'reset' };
  ForgotPassword: undefined;

  // Shell
  MainTabs: undefined;

  // Feed and discovery
  VideoPlayer: { videoId: string };
  Search: undefined;
  Categories: undefined;
  CategoryFeed: { categoryId: string; name: string };
  Hashtag: { tag: string };
  SoundDetail: { soundId: string };

  // Creation
  Record: undefined;
  Upload: undefined;
  Editor: undefined;
  Filters: undefined;
  Effects: undefined;
  Adjust: undefined;
  TextOnVideo: undefined;
  Stickers: undefined;
  Music: undefined;
  Voiceover: undefined;
  CoverPicker: undefined;
  CaptionEditor: undefined;
  PostSettings: undefined;
  Drafts: undefined;

  // Profile and social
  Profile: { userId: string };
  EditProfile: undefined;
  Followers: { userId: string };
  Following: { userId: string };

  // Messaging
  PrivateChat: { chatId: string };
  GroupChat: { chatId: string };
  GroupInfo: { chatId: string };
  Community: { communityId: string };
  CommunityInfo: { communityId: string };
  CommunityRequests: { communityId: string };
  Communities: undefined;

  // Calls
  VoiceCall: { userId: string };
  VideoCall: { userId: string };
  GroupCall: { chatId?: string };
  CallHistory: undefined;

  // Live
  LiveList: undefined;
  LiveSetup: undefined;
  /** Absent with no backend: the screen then runs as a local preview. */
  LiveBroadcast: { streamId?: string } | undefined;
  LiveViewer: { streamId: string };

  // Money
  Wallet: undefined;
  BuyCoins: undefined;
  Transactions: undefined;
  Monetization: undefined;
  DailyTasks: undefined;
  Referral: undefined;
  LiveEarnings: undefined;
  Withdraw: undefined;
  Promotion: { videoId?: string };
  Ads: undefined;
  CampaignBuilder: undefined;
  CreatorDashboard: undefined;
  BusinessAnalytics: undefined;

  // Account
  Verification: undefined;
  Settings: undefined;
  Privacy: undefined;
  LoginActivity: undefined;
  ChangePassword: undefined;
  NotificationSettings: undefined;
  BlockedUsers: undefined;
  Reports: undefined;
  Support: undefined;
  NewTicket: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Explore: undefined;
  Create: undefined;
  Inbox: undefined;
  ProfileTab: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type TabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
