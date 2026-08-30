import { VideoFilter, VideoEffect, AdjustmentControl, StickerPack, Sound } from '../types';
import { sounds } from './videos';

/**
 * Creative asset catalogue.
 *
 * In production every one of these rows is served by the backend and managed from
 * Super Admin -> Creative Assets (add, edit, enable, disable, reorder, mark
 * trending/new/premium), so the catalogue changes without an app release.
 */

// ─────────────────────────────── Filters ────────────────────────────────

/** `previewColor` tints the carousel thumbnail; the real filter is a GPU shader. */
export const filters: VideoFilter[] = [
  { id: 'f_original', name: 'Original', previewColor: 'transparent', intensity: 0, order: 1 },
  { id: 'f_natural', name: 'Natural', previewColor: 'rgba(255,245,230,0.14)', intensity: 60, order: 2 },
  { id: 'f_warm', name: 'Warm', previewColor: 'rgba(255,168,84,0.22)', intensity: 70, order: 3, isTrending: true },
  { id: 'f_cool', name: 'Cool', previewColor: 'rgba(84,168,255,0.22)', intensity: 70, order: 4 },
  { id: 'f_bright', name: 'Bright', previewColor: 'rgba(255,255,255,0.20)', intensity: 55, order: 5 },
  { id: 'f_dark', name: 'Dark', previewColor: 'rgba(0,0,0,0.28)', intensity: 55, order: 6 },
  { id: 'f_vintage', name: 'Vintage', previewColor: 'rgba(196,154,108,0.30)', intensity: 75, order: 7, isTrending: true },
  { id: 'f_film', name: 'Film', previewColor: 'rgba(122,110,92,0.28)', intensity: 72, order: 8 },
  { id: 'f_cinematic', name: 'Cinematic', previewColor: 'rgba(24,44,84,0.32)', intensity: 80, order: 9, isTrending: true },
  { id: 'f_retro', name: 'Retro', previewColor: 'rgba(226,120,160,0.26)', intensity: 68, order: 10 },
  { id: 'f_bw', name: 'B & W', previewColor: 'rgba(128,128,128,0.45)', intensity: 100, order: 11 },
  { id: 'f_sepia', name: 'Sepia', previewColor: 'rgba(168,124,72,0.38)', intensity: 85, order: 12 },
  { id: 'f_vibrant', name: 'Vibrant', previewColor: 'rgba(255,80,140,0.20)', intensity: 78, order: 13, isNew: true },
  { id: 'f_soft', name: 'Soft', previewColor: 'rgba(255,224,230,0.24)', intensity: 50, order: 14 },
  { id: 'f_high_contrast', name: 'High Contrast', previewColor: 'rgba(10,10,10,0.22)', intensity: 88, order: 15 },
  { id: 'f_low_contrast', name: 'Low Contrast', previewColor: 'rgba(180,180,190,0.24)', intensity: 40, order: 16 },
  { id: 'f_golden', name: 'Golden', previewColor: 'rgba(255,196,64,0.28)', intensity: 74, order: 17, isPremium: true },
  { id: 'f_night', name: 'Night', previewColor: 'rgba(20,28,72,0.42)', intensity: 82, order: 18, isPremium: true },
  { id: 'f_portrait', name: 'Portrait', previewColor: 'rgba(255,208,196,0.22)', intensity: 65, order: 19, isNew: true },
  { id: 'f_landscape', name: 'Landscape', previewColor: 'rgba(96,196,140,0.22)', intensity: 66, order: 20 },
];

// ─────────────────────────────── Effects ────────────────────────────────

export const effects: VideoEffect[] = [
  { id: 'e_blur', name: 'Blur', category: 'light', icon: 'water-outline' },
  { id: 'e_zoom', name: 'Zoom', category: 'motion', icon: 'scan-outline', isTrending: true },
  { id: 'e_shake', name: 'Shake', category: 'motion', icon: 'pulse-outline' },
  { id: 'e_flash', name: 'Flash', category: 'light', icon: 'flash-outline' },
  { id: 'e_glitch', name: 'Glitch', category: 'color', icon: 'tv-outline', isTrending: true },
  { id: 'e_slowmo', name: 'Slow Motion', category: 'time', icon: 'hourglass-outline' },
  { id: 'e_fastmo', name: 'Fast Motion', category: 'time', icon: 'speedometer-outline' },
  { id: 'e_reverse', name: 'Reverse', category: 'time', icon: 'play-back-outline' },
  { id: 'e_fade', name: 'Fade', category: 'transition', icon: 'contrast-outline' },
  { id: 'e_swipe', name: 'Swipe', category: 'transition', icon: 'swap-horizontal-outline' },
  { id: 'e_spin', name: 'Spin', category: 'transition', icon: 'sync-outline', isNew: true },
  { id: 'e_bokeh', name: 'Bokeh', category: 'light', icon: 'ellipse-outline', isPremium: true },
  { id: 'e_lensflare', name: 'Lens Flare', category: 'light', icon: 'sunny-outline', isPremium: true },
  { id: 'e_duotone', name: 'Duotone', category: 'color', icon: 'color-filter-outline' },
  { id: 'e_neon', name: 'Neon', category: 'color', icon: 'color-wand-outline', isNew: true },
  { id: 'e_greenscreen', name: 'Green Screen', category: 'background', icon: 'image-outline' },
  { id: 'e_blurbg', name: 'Blur Background', category: 'background', icon: 'layers-outline' },
  { id: 'e_replacebg', name: 'Replace BG', category: 'background', icon: 'images-outline', isPremium: true },
];

export const effectCategories = [
  { id: 'all', label: 'All' },
  { id: 'motion', label: 'Motion' },
  { id: 'light', label: 'Light' },
  { id: 'color', label: 'Color' },
  { id: 'transition', label: 'Transition' },
  { id: 'background', label: 'Background' },
  { id: 'time', label: 'Time' },
] as const;

// ───────────────────────── Manual adjustments ───────────────────────────

export const adjustmentControls: AdjustmentControl[] = [
  { id: 'brightness', label: 'Brightness', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'contrast', label: 'Contrast', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'saturation', label: 'Saturation', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'exposure', label: 'Exposure', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'highlights', label: 'Highlights', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'shadows', label: 'Shadows', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'temperature', label: 'Temperature', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'tint', label: 'Tint', value: 0, min: -100, max: 100, defaultValue: 0 },
  { id: 'sharpness', label: 'Sharpness', value: 0, min: 0, max: 100, defaultValue: 0 },
  { id: 'fade', label: 'Fade', value: 0, min: 0, max: 100, defaultValue: 0 },
  { id: 'vignette', label: 'Vignette', value: 0, min: 0, max: 100, defaultValue: 0 },
];

// ────────────────────────── Beauty adjustments ──────────────────────────

/**
 * Rendering options only. These never become ranking or targeting features
 * (see ADR-008 / PHASE_04).
 */
export const beautyControls: AdjustmentControl[] = [
  { id: 'smoothing', label: 'Skin Smoothing', value: 0, min: 0, max: 100, defaultValue: 0 },
  { id: 'face_brightness', label: 'Brightness', value: 0, min: 0, max: 100, defaultValue: 0 },
  { id: 'face_light', label: 'Face Light', value: 0, min: 0, max: 100, defaultValue: 0 },
  { id: 'bg_blur', label: 'Background Blur', value: 0, min: 0, max: 100, defaultValue: 0 },
];

// ─────────────────────────────── Stickers ───────────────────────────────

export const stickerPacks: StickerPack[] = [
  {
    id: 'sp_emoji',
    name: 'Emoji',
    stickers: ['😂', '🔥', '❤️', '😍', '👏', '🙌', '💯', '😭', '🤯', '✨', '🎉', '👀', '🥹', '🤝', '🚀', '💀'],
  },
  {
    id: 'sp_reactions',
    name: 'Reactions',
    stickers: ['👍', '👎', '🤔', '😮', '😴', '🤷', '🙃', '😎', '🥳', '😅', '🫡', '🤌'],
    isNew: true,
  },
  {
    id: 'sp_creator',
    name: 'Creator',
    stickers: ['📈', '🎬', '🎧', '🎨', '📱', '💡', '⚡', '🏆', '⭐', '🔔', '💬', '📌'],
  },
  {
    id: 'sp_life',
    name: 'Everyday',
    stickers: ['☕', '🍕', '🏋️', '🚗', '✈️', '🌙', '☀️', '🌊', '🐕', '🌱', '🎂', '🎁'],
  },
];

// ────────────────────────────── Text styles ─────────────────────────────

export const textFonts = [
  { id: 'classic', label: 'Classic' },
  { id: 'bold', label: 'Bold' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
  { id: 'handwriting', label: 'Handwrite' },
  { id: 'condensed', label: 'Condensed' },
];

export const textAnimations = [
  { id: 'none', label: 'None' },
  { id: 'typewriter', label: 'Typewriter' },
  { id: 'fade', label: 'Fade In' },
  { id: 'pop', label: 'Pop' },
  { id: 'slide', label: 'Slide' },
  { id: 'bounce', label: 'Bounce' },
];

export const textColors = [
  '#FFFFFF', '#000000', '#FE2C55', '#25F4EE', '#FFC93C',
  '#22C55E', '#3B82F6', '#A855F7', '#F97316', '#EC4899',
];

// ──────────────────────────────── Speed ─────────────────────────────────

export const speedOptions = [
  { id: '0.5', label: '0.5x', value: 0.5 },
  { id: '0.75', label: '0.75x', value: 0.75 },
  { id: '1', label: '1x', value: 1 },
  { id: '1.5', label: '1.5x', value: 1.5 },
  { id: '2', label: '2x', value: 2 },
];

// ──────────────────────────────── Music ─────────────────────────────────

export const musicCategories = [
  'Trending', 'New', 'Hip Hop', 'Electronic', 'Lofi', 'Acoustic',
  'Ambient', 'Rock', 'Pop', 'Cinematic', 'Sound Effects',
];

export const musicLibrary: Sound[] = [
  ...sounds,
  {
    id: 's_9',
    title: 'Retro Arcade',
    artist: 'BitWave',
    cover: 'https://picsum.photos/seed/sound9/200/200',
    durationSec: 30,
    isOriginal: false,
    usageCount: 412000,
    category: 'Electronic',
    isTrending: true,
  },
  {
    id: 's_10',
    title: 'Slow Sunset',
    artist: 'Maren',
    cover: 'https://picsum.photos/seed/sound10/200/200',
    durationSec: 55,
    isOriginal: false,
    usageCount: 96000,
    category: 'Ambient',
  },
  {
    id: 's_11',
    title: 'Big Room Energy',
    artist: 'Volt',
    cover: 'https://picsum.photos/seed/sound11/200/200',
    durationSec: 26,
    isOriginal: false,
    usageCount: 1840000,
    category: 'Pop',
    isTrending: true,
  },
  {
    id: 's_12',
    title: 'Whoosh Pack',
    artist: 'Platform Sounds',
    cover: 'https://picsum.photos/seed/sound12/200/200',
    durationSec: 8,
    isOriginal: false,
    usageCount: 2400000,
    category: 'Sound Effects',
  },
];

export const trendingMusic = musicLibrary.filter((s) => s.isTrending);
export const favoriteMusic = musicLibrary.filter((s) => s.isFavorite);

// ─────────────────────────────── Drafts ─────────────────────────────────

export const drafts = [
  {
    id: 'd_1',
    poster: 'https://picsum.photos/seed/draft1/540/960',
    caption: 'Behind the scenes of the new studio setup',
    durationSec: 42,
    updatedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    clipCount: 6,
  },
  {
    id: 'd_2',
    poster: 'https://picsum.photos/seed/draft2/540/960',
    caption: '',
    durationSec: 18,
    updatedAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
    clipCount: 2,
  },
  {
    id: 'd_3',
    poster: 'https://picsum.photos/seed/draft3/540/960',
    caption: 'Answering the top comment from last week',
    durationSec: 61,
    updatedAt: new Date(Date.now() - 9 * 86400 * 1000).toISOString(),
    clipCount: 11,
  },
];

// ────────────────────────── Editor clip timeline ────────────────────────

export const editorClips = [
  { id: 'clip_1', thumb: 'https://picsum.photos/seed/clip1/120/200', durationSec: 6.4, speed: 1 },
  { id: 'clip_2', thumb: 'https://picsum.photos/seed/clip2/120/200', durationSec: 9.1, speed: 1 },
  { id: 'clip_3', thumb: 'https://picsum.photos/seed/clip3/120/200', durationSec: 4.8, speed: 0.5 },
  { id: 'clip_4', thumb: 'https://picsum.photos/seed/clip4/120/200', durationSec: 12.2, speed: 1 },
  { id: 'clip_5', thumb: 'https://picsum.photos/seed/clip5/120/200', durationSec: 7.5, speed: 1.5 },
];

/** Frames offered by the cover picker scrubber. */
export const coverFrames = Array.from({ length: 12 }, (_, i) => ({
  id: `frame_${i}`,
  thumb: `https://picsum.photos/seed/cover${i}/120/200`,
  atSecond: i * 3,
  /** The intelligence service suggests the strongest thumbnail candidate. */
  isSuggested: i === 4,
}));

/** Gallery items for the upload picker. */
export const galleryItems = Array.from({ length: 24 }, (_, i) => ({
  id: `gal_${i}`,
  thumb: `https://picsum.photos/seed/gal${i}/300/300`,
  durationSec: 12 + ((i * 7) % 48),
}));
