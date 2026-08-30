import { Category, Hashtag } from '../types';
import { users } from './users';
import { videos } from './videos';

export const categories: Category[] = [
  { id: 'cat_tech', name: 'Technology', icon: 'hardware-chip-outline', color: '#3B82F6', videoCount: 1840000 },
  { id: 'cat_gaming', name: 'Gaming', icon: 'game-controller-outline', color: '#A855F7', videoCount: 3210000 },
  { id: 'cat_business', name: 'Business', icon: 'briefcase-outline', color: '#22C55E', videoCount: 940000 },
  { id: 'cat_education', name: 'Education', icon: 'school-outline', color: '#F59E0B', videoCount: 1240000 },
  { id: 'cat_sports', name: 'Sports', icon: 'fitness-outline', color: '#EF4444', videoCount: 2180000 },
  { id: 'cat_comedy', name: 'Comedy', icon: 'happy-outline', color: '#FFC93C', videoCount: 4820000 },
  { id: 'cat_fashion', name: 'Fashion', icon: 'shirt-outline', color: '#EC4899', videoCount: 2640000 },
  { id: 'cat_beauty', name: 'Beauty', icon: 'sparkles-outline', color: '#F472B6', videoCount: 1980000 },
  { id: 'cat_cars', name: 'Cars', icon: 'car-sport-outline', color: '#06B6D4', videoCount: 1420000 },
  { id: 'cat_food', name: 'Food', icon: 'restaurant-outline', color: '#F97316', videoCount: 3140000 },
  { id: 'cat_travel', name: 'Travel', icon: 'airplane-outline', color: '#14B8A6', videoCount: 1680000 },
  { id: 'cat_music', name: 'Music', icon: 'musical-notes-outline', color: '#8B5CF6', videoCount: 5210000 },
  { id: 'cat_ai', name: 'AI', icon: 'bulb-outline', color: '#25F4EE', videoCount: 620000 },
  { id: 'cat_entertainment', name: 'Entertainment', icon: 'film-outline', color: '#FE2C55', videoCount: 6120000 },
];

export const trendingHashtags: Hashtag[] = [
  { id: 'h_1', tag: 'buildinpublic', views: 2840000000 },
  { id: 'h_2', tag: 'devtips', views: 1240000000 },
  { id: 'h_3', tag: 'garagebuild', views: 890000000 },
  { id: 'h_4', tag: 'streetfood', views: 4210000000 },
  { id: 'h_5', tag: 'sunrisechallenge', views: 620000000, isOfficial: true },
  { id: 'h_6', tag: 'creatorfund', views: 340000000, isOfficial: true },
  { id: 'h_7', tag: 'autumncollection', views: 128000000, isSponsored: true },
  { id: 'h_8', tag: 'indiegame', views: 780000000 },
  { id: 'h_9', tag: 'moneytalk', views: 1980000000 },
  { id: 'h_10', tag: 'woodworking', views: 1120000000 },
];

export const recentSearches = [
  'async javascript',
  'engine rebuild',
  'lofi beats',
  '@maya.codes',
  'street food accra',
];

export const suggestedSearches = [
  'video editing tips',
  'best filters 2026',
  'how the algorithm works',
  'small business marketing',
  'indie game devlog',
  'sunrise hikes',
];

export const searchTabs = ['Top', 'Users', 'Videos', 'Sounds', 'Hashtags'] as const;

/** Nearby is permission-gated: nothing loads until the user grants location. */
export const nearbyVideos = videos.slice(2, 8).map((v) => ({
  ...v,
  location: v.location ?? 'Within 12 km',
}));

export const featuredCreators = [users[1], users[6], users[11], users[9], users[4]];

/** Explore banners are managed from Super Admin -> Banners. */
export const exploreBanners = [
  {
    id: 'bn_1',
    title: 'Sunrise Challenge',
    subtitle: 'Post before 7am. Top 50 get featured.',
    image: 'https://picsum.photos/seed/banner1/900/400',
    cta: 'Join challenge',
  },
  {
    id: 'bn_2',
    title: 'New: Cinematic filters',
    subtitle: 'Four new looks in the editor today.',
    image: 'https://picsum.photos/seed/banner2/900/400',
    cta: 'Try them',
  },
  {
    id: 'bn_3',
    title: 'Creator Fund is open',
    subtitle: 'Apply if you have 10k+ followers.',
    image: 'https://picsum.photos/seed/banner3/900/400',
    cta: 'Apply now',
  },
];

export const onboardingInterests = [
  'Technology', 'Gaming', 'Business', 'Education', 'Sports', 'Comedy',
  'Fashion', 'Beauty', 'Cars', 'Food', 'Travel', 'Music', 'AI',
  'Fitness', 'Art', 'Photography', 'Science', 'Pets', 'DIY', 'Finance',
];
