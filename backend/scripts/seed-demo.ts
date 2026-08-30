/**
 * Demo content.
 *
 * Creates a handful of creators with published videos so the feed, profiles and
 * recommendation engine have something real to serve while the UI is being
 * wired up. Everything it creates is prefixed `demo_`, so it is easy to see and
 * easy to remove.
 *
 * Idempotent: running it twice does not duplicate anything.
 *
 * This is development seed data, not test fixtures — it stays in the database
 * on purpose, so the app has content when you open it.
 */

import { ulid } from 'ulid';
import { execute, pool, query, queryOne } from '../src/core/db.ts';
import { redis } from '../src/core/redis.ts';
import { hashPassword } from '../src/modules/auth/password.ts';

const PASSWORD = 'Demo-Passphrase!1';

const CREATORS = [
  { username: 'demo_maya', name: 'Maya Chen', category: 'technology', followers: 12_400 },
  { username: 'demo_arjun', name: 'Arjun Patel', category: 'gaming', followers: 8_900 },
  { username: 'demo_sofia', name: 'Sofia Rossi', category: 'food', followers: 24_100 },
  { username: 'demo_kai', name: 'Kai Nakamura', category: 'music', followers: 5_600 },
  { username: 'demo_zara', name: 'Zara Ahmed', category: 'fashion', followers: 31_200 },
  // Deliberately left with no followers, so the new-creator exploration budget
  // has something real to surface.
  { username: 'demo_newbie', name: 'Sam Rivera', category: 'travel', followers: 12 },
];

const CAPTIONS: Record<string, string[]> = {
  technology: [
    'Building my first mechanical keyboard',
    'This tiny server runs my whole home',
    'Why I switched back to a wired mouse',
    'The cable management nobody sees',
    'Repairing a laptop everyone said was dead',
    'One script that saves me an hour a week',
    'What is actually inside a cheap charger',
    'My desk setup after four years of tweaking',
  ],
  gaming: [
    'That comeback was unreal',
    'Speedrun attempt number forty-one',
    'Nobody expected this ending',
    'Found a shortcut after 200 hours',
    'The physics in this game are broken',
    'Beating the boss without taking damage',
    'This controller mod changed everything',
    'Playing the tutorial as a speedrun',
  ],
  food: [
    'Thirty second garlic noodles',
    'The trick is resting the dough',
    'Breakfast that takes one pan',
    'My grandmother measured nothing',
    'Cheap cut, slow cooked, worth it',
    'Why your rice keeps sticking',
    'Bread with four ingredients',
    'The sauce that fixes any pasta',
  ],
  music: [
    'Layering the bassline',
    'Found this chord by accident',
    'One take, no edits',
    'Turning a mistake into the hook',
    'This pedal cost more than the guitar',
    'Writing a song in a stairwell',
    'The drum pattern took three days',
    'Recording with one microphone',
  ],
  fashion: [
    'Thrifted the whole outfit',
    'Three ways to wear one jacket',
    'This fabric moves beautifully',
    'Mending instead of replacing',
    'The tailoring trick that fixes everything',
    'Building a wardrobe from eight pieces',
    'Colour matching without thinking',
    'Shoes that survived four winters',
  ],
  travel: [
    'Missed the train, found this instead',
    'Six hours in a city I cannot pronounce',
    'Cheapest meal of the trip',
    'The view was not on any map',
    'Packing for two weeks in one bag',
    'Getting lost on purpose',
    'The night bus was a mistake',
    'Everyone walked past this street',
  ],
};

/** A small music library, so the create flow has real tracks to browse. */
const TRACKS = [
  { title: 'Midnight Drive', artist: 'Echo Ridge', category: 'electronic', duration: 178, trending: 1 },
  { title: 'Paper Boats', artist: 'Lila Moss', category: 'acoustic', duration: 145, trending: 1 },
  { title: 'Concrete Garden', artist: 'North Yard', category: 'hip hop', duration: 201, trending: 0 },
  { title: 'Slow Tide', artist: 'Marea', category: 'ambient', duration: 232, trending: 0 },
  { title: 'Neon Market', artist: 'Kite String', category: 'electronic', duration: 164, trending: 1 },
  { title: 'Second Floor', artist: 'The Lamps', category: 'indie', duration: 189, trending: 0 },
  { title: 'Golden Hour', artist: 'Ana Ruiz', category: 'pop', duration: 172, trending: 1 },
  { title: 'Old Radio', artist: 'Fenwick', category: 'folk', duration: 155, trending: 0 },
];

async function seedMusic(): Promise<number> {
  let created = 0;
  for (const track of TRACKS) {
    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM music_tracks WHERE title = :title AND artist = :artist',
      { title: track.title, artist: track.artist },
    );
    if (existing) continue;

    await execute(
      `INSERT INTO music_tracks
         (public_id, title, artist, category, audio_url, cover_url, duration_sec,
          licence_status, is_trending, is_enabled, usage_count)
       VALUES (:publicId, :title, :artist, :category, :audioUrl, :coverUrl, :duration,
               'licensed', :trending, 1, :usage)`,
      {
        publicId: ulid(),
        title: track.title,
        artist: track.artist,
        category: track.category,
        // No real audio behind these; the URL is left empty so the row is
        // well-formed rather than pretending a file exists.
        audioUrl: '',
        coverUrl: 'https://picsum.photos/seed/' + track.title.replace(/ /g, '') + '/200/200',
        duration: track.duration,
        trending: track.trending,
        usage: Math.floor(Math.random() * 5000),
      },
    );
    created += 1;
  }
  return created;
}

/**
 * A real follow graph between the demo creators.
 *
 * The seeded `follower_count` values are headline numbers with nothing behind
 * them, which makes the profile disagree with the followers list: 12.4K on the
 * profile, nobody in the list. Rather than invent thousands of accounts, the
 * demo builds the edges that actually exist and then recomputes the counters
 * from them, so every number on screen is one you can click through to.
 */
async function seedFollowGraph(): Promise<number> {
  const demo = await query<{ id: number; username: string }>(
    "SELECT id, username FROM users WHERE email LIKE 'demo\\_%' AND deleted_at IS NULL",
  );
  if (demo.length < 2) return 0;

  let created = 0;
  for (const follower of demo) {
    for (const followee of demo) {
      if (follower.id === followee.id) continue;
      // The newest account follows everyone but is followed by only one, which
      // is what a genuinely new creator's graph looks like.
      if (followee.username === 'demo_newbie' && follower.username !== 'demo_maya') continue;

      // `affectedRows` does not reliably distinguish an insert from a no-op
      // upsert here, so the edge count is read back from the table afterwards
      // rather than inferred — a seed that reports work it did not do is worse
      // than one that reports nothing.
      await execute(
        `INSERT INTO follows (follower_id, followee_id)
         VALUES (:follower, :followee)
         ON DUPLICATE KEY UPDATE deleted_at = NULL`,
        { follower: follower.id, followee: followee.id },
      );
      created += 1;
    }
  }

  // Counters are derived, never typed in by hand.
  await execute(
    `UPDATE user_profiles p
        SET p.follower_count = (
              SELECT COUNT(*) FROM follows f
               WHERE f.followee_id = p.user_id AND f.deleted_at IS NULL),
            p.following_count = (
              SELECT COUNT(*) FROM follows f
               WHERE f.follower_id = p.user_id AND f.deleted_at IS NULL)
      WHERE p.user_id IN (${demo.map((d) => d.id).join(',')})`,
  );

  void created;

  const total = await queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM follows WHERE deleted_at IS NULL',
  );
  return Number(total?.c ?? 0);
}

/**
 * Rebuild the denormalised profile counters for the demo accounts.
 *
 * In normal operation `publish.service` increments `video_count` as each video
 * goes live. The seed inserts rows directly, so those counters stay at zero and
 * the profile claims no videos while the grid shows eight. Recomputing from the
 * rows keeps every number on a demo profile something you can verify.
 *
 * This touches demo accounts only — real profiles keep the counters the
 * application maintains.
 */
async function recountDemoProfiles(): Promise<void> {
  await execute(
    `UPDATE user_profiles p
       JOIN users u ON u.id = p.user_id
        SET p.video_count = (
              SELECT COUNT(*) FROM videos v
               WHERE v.user_id = p.user_id
                 AND v.deleted_at IS NULL
                 AND v.status = 'published'),
            p.like_count = (
              SELECT COALESCE(SUM(v.like_count), 0) FROM videos v
               WHERE v.user_id = p.user_id
                 AND v.deleted_at IS NULL
                 AND v.status = 'published')
      WHERE u.email LIKE 'demo\\_%'
        AND u.deleted_at IS NULL`,
  );
}

/** Hashtags that suit each demo creator's subject. */
const CATEGORY_TAGS: Record<string, string[]> = {
  technology: ['tech', 'coding', 'devtips', 'buildinpublic'],
  gaming: ['gaming', 'clutch', 'speedrun', 'gamedev'],
  food: ['food', 'recipe', 'quickmeals', 'homecooking'],
  music: ['music', 'producer', 'basslines', 'studio'],
  fashion: ['fashion', 'thrifted', 'ootd', 'styling'],
  travel: ['travel', 'wanderlust', 'citybreak', 'solotravel'],
};

/**
 * Attach hashtags to the demo videos.
 *
 * `publish.service` writes `hashtags` and `video_hashtags` as each video goes
 * live. The seed inserts video rows directly, so the demo library has no tags at
 * all and the discovery screens fall back to whatever a smoke test happened to
 * leave behind.
 *
 * The counters are then recomputed from the link table for *every* tag, not just
 * the demo ones. `video_count` is a derived value, and the rows left by earlier
 * test runs claim videos that no longer exist — a tag advertising 23 videos and
 * opening onto an empty list is worse than one that says 0. Recomputing repairs
 * it; nothing is deleted.
 */
async function seedHashtags(): Promise<number> {
  const videos = await query<{ id: number; category: string }>(
    `SELECT v.id, c.slug AS category
       FROM videos v
       JOIN users u ON u.id = v.user_id
       LEFT JOIN categories c ON c.id = v.category_id
      WHERE u.email LIKE 'demo\\_%' AND v.deleted_at IS NULL`,
  );

  let links = 0;
  for (const video of videos) {
    const tags = CATEGORY_TAGS[video.category] ?? ['vyra'];
    // Two per video: enough for the tag screens to have several videos each
    // without every video carrying every tag.
    const chosen = [tags[0], tags[1 + (video.id % Math.max(1, tags.length - 1))]].filter(
      (t): t is string => typeof t === 'string',
    );

    for (const tag of new Set(chosen)) {
      await execute(
        'INSERT INTO hashtags (tag, video_count) VALUES (:tag, 0) ON DUPLICATE KEY UPDATE tag = tag',
        { tag },
      );
      const row = await queryOne<{ id: number }>('SELECT id FROM hashtags WHERE tag = :tag', {
        tag,
      });
      if (!row) continue;

      await execute(
        `INSERT INTO video_hashtags (video_id, hashtag_id) VALUES (:videoId, :hashtagId)
         ON DUPLICATE KEY UPDATE hashtag_id = hashtag_id`,
        { videoId: video.id, hashtagId: row.id },
      );
      links += 1;
    }
  }

  // Derived from the links that actually exist, and from the views those videos
  // actually have.
  await execute(
    `UPDATE hashtags h
        SET h.video_count = (
              SELECT COUNT(*) FROM video_hashtags vh
                JOIN videos v ON v.id = vh.video_id
               WHERE vh.hashtag_id = h.id AND v.deleted_at IS NULL),
            h.view_count = (
              SELECT COALESCE(SUM(v.view_count), 0) FROM video_hashtags vh
                JOIN videos v ON v.id = vh.video_id
               WHERE vh.hashtag_id = h.id AND v.deleted_at IS NULL)
      WHERE h.id > 0`,
  );

  return links;
}

/** A short exchange for each demo conversation. */
const DEMO_THREADS: { with: string; lines: { from: 'me' | 'them'; text: string }[] }[] = [
  {
    with: 'demo_zara',
    lines: [
      { from: 'them', text: 'Sent you the draft — tell me what you think' },
      { from: 'me', text: 'Looks good. The transition at 0:12 is doing a lot of work' },
      { from: 'them', text: 'That was the third take. The first two were unusable' },
      { from: 'me', text: 'Worth it. Ship it' },
    ],
  },
  {
    with: 'demo_kai',
    lines: [
      { from: 'me', text: 'Is the bassline from your own kit?' },
      { from: 'them', text: 'All of it. Took an afternoon to get the low end right' },
      { from: 'them', text: 'Happy for you to use it if you credit the track' },
    ],
  },
  {
    with: 'demo_sofia',
    lines: [
      { from: 'them', text: 'Thirty second garlic noodles went a bit far' },
      { from: 'me', text: 'I saw. 24K in a day is not nothing' },
    ],
  },
];

/**
 * Seed a few conversations.
 *
 * Written through the same tables the chat service reads, including the receipt
 * rows, so unread counts and delivery ticks are real rather than decorative. The
 * demo owner is `demo_maya`, which is the account the browser signs in as.
 */
async function seedChats(): Promise<number> {
  const maya = await queryOne<{ id: number }>(
    "SELECT id FROM users WHERE username = 'demo_maya'",
  );
  if (!maya) return 0;

  let created = 0;

  for (const thread of DEMO_THREADS) {
    const other = await queryOne<{ id: number }>('SELECT id FROM users WHERE username = :username', {
      username: thread.with,
    });
    if (!other) continue;

    let chat = await queryOne<{ id: number }>(
      `SELECT c.id
         FROM chats c
         JOIN chat_participants a ON a.chat_id = c.id AND a.user_id = :me
         JOIN chat_participants b ON b.chat_id = c.id AND b.user_id = :other
        WHERE c.kind = 'private' AND c.deleted_at IS NULL
        LIMIT 1`,
      { me: maya.id, other: other.id },
    );

    if (!chat) {
      const result = await execute(
        `INSERT INTO chats (public_id, kind, owner_id, member_count)
         VALUES (:publicId, 'private', :owner, 2)`,
        { publicId: ulid(), owner: maya.id },
      );
      // Backdated ahead of the oldest seeded message. History before a
      // participant joined is deliberately hidden, so a join time of "now"
      // would make the whole seeded conversation invisible.
      await execute(
        `INSERT INTO chat_participants (chat_id, user_id, role, joined_at)
         VALUES (:chatId, :me, 'member', :joinedAt),
                (:chatId, :other, 'member', :joinedAt)`,
        {
          chatId: result.insertId,
          me: maya.id,
          other: other.id,
          joinedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      );
      chat = { id: result.insertId };
      created += 1;
    }

    for (const [index, line] of thread.lines.entries()) {
      const senderId = line.from === 'me' ? maya.id : other.id;
      const recipientId = line.from === 'me' ? other.id : maya.id;

      // Idempotent on the same key the application uses, so re-running the seed
      // does not duplicate the conversation.
      const clientId = `seed-${thread.with}-${index}`;
      const already = await queryOne<{ id: number }>(
        'SELECT id FROM messages WHERE sender_id = :senderId AND client_id = :clientId',
        { senderId, clientId },
      );
      if (already) continue;

      const inserted = await execute(
        `INSERT INTO messages (public_id, client_id, chat_id, sender_id, kind, body, created_at)
         VALUES (:publicId, :clientId, :chatId, :senderId, 'text', :body,
                 DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :minutesAgo MINUTE))`,
        {
          publicId: ulid(),
          clientId,
          chatId: chat.id,
          senderId,
          body: line.text,
          minutesAgo: (thread.lines.length - index) * 7,
        },
      );

      // The last message from the other side is left unread, so the inbox badge
      // is a real count rather than a number typed into a mock.
      const isLast = index === thread.lines.length - 1;
      const seen = !(line.from === 'them' && isLast);

      await execute(
        `INSERT INTO message_receipts (message_id, user_id, delivered_at, seen_at)
         VALUES (:messageId, :userId, CURRENT_TIMESTAMP(3), :seenAt)
         ON DUPLICATE KEY UPDATE delivered_at = VALUES(delivered_at)`,
        {
          messageId: inserted.insertId,
          userId: recipientId,
          seenAt: seen ? new Date() : null,
        },
      );
    }

    await execute(
      `UPDATE chats SET last_message_at = (SELECT MAX(created_at) FROM messages WHERE chat_id = :chatId)
        WHERE id = :chatId`,
      { chatId: chat.id },
    );

    // Counts derived from the receipts, never typed in.
    await execute(
      `UPDATE chat_participants p
          SET p.unread_count = (
                SELECT COUNT(*) FROM message_receipts r
                  JOIN messages m ON m.id = r.message_id
                 WHERE r.user_id = p.user_id AND m.chat_id = p.chat_id AND r.seen_at IS NULL)
        WHERE p.chat_id = :chatId`,
      { chatId: chat.id },
    );
  }

  return created;
}

/**
 * One public community, so the community screens have something real to show.
 */
async function seedCommunity(): Promise<boolean> {
  const maya = await queryOne<{ id: number }>(
    "SELECT id FROM users WHERE username = 'demo_maya'",
  );
  if (!maya) return false;

  const existing = await queryOne<{ id: number }>(
    "SELECT id FROM communities WHERE name = 'Editor Beta Testers'",
  );
  if (existing) return false;

  const chatResult = await execute(
    `INSERT INTO chats (public_id, kind, title, description, owner_id, member_count)
     VALUES (:publicId, 'community', 'Editor Beta Testers', :description, :owner, 1)`,
    {
      publicId: ulid(),
      description: 'Early access to the editor, and somewhere to say what breaks.',
      owner: maya.id,
    },
  );
  const chatId = chatResult.insertId;

  await execute(
    `INSERT INTO chat_participants (chat_id, user_id, role) VALUES (:chatId, :userId, 'owner')`,
    { chatId, userId: maya.id },
  );

  const communityResult = await execute(
    `INSERT INTO communities (public_id, chat_id, name, description, rules, is_private, owner_id, member_count)
     VALUES (:publicId, :chatId, 'Editor Beta Testers', :description, :rules, 0, :owner, 1)`,
    {
      publicId: ulid(),
      chatId,
      description: 'Early access to the editor, and somewhere to say what breaks.',
      rules: JSON.stringify([
        'Report bugs with the steps that caused them.',
        'No promotion of other apps.',
        'Be direct about what is broken; be kind about who broke it.',
      ]),
      owner: maya.id,
    },
  );

  await execute(
    `INSERT INTO community_members (community_id, user_id, role)
     VALUES (:communityId, :userId, 'owner')`,
    { communityId: communityResult.insertId, userId: maya.id },
  );

  // A few of the other demo creators, so the roster rule has something to hide.
  const others = await query<{ id: number }>(
    "SELECT id FROM users WHERE username IN ('demo_zara', 'demo_kai', 'demo_sofia', 'demo_arjun')",
  );
  for (const member of others) {
    await execute(
      `INSERT INTO community_members (community_id, user_id, role)
       VALUES (:communityId, :userId, 'member')
       ON DUPLICATE KEY UPDATE left_at = NULL`,
      { communityId: communityResult.insertId, userId: member.id },
    );
    await execute(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       VALUES (:chatId, :userId, 'member')
       ON DUPLICATE KEY UPDATE left_at = NULL`,
      { chatId, userId: member.id },
    );
  }

  await execute(
    `UPDATE communities SET member_count = :count WHERE id = :id`,
    { count: others.length + 1, id: communityResult.insertId },
  );
  await execute('UPDATE chats SET member_count = :count WHERE id = :id', {
    count: others.length + 1,
    id: chatId,
  });

  return true;
}

async function main(): Promise<void> {
  console.log('\n  Seeding demo content\n');

  const passwordHash = await hashPassword(PASSWORD);
  let createdUsers = 0;
  let createdVideos = 0;

  for (const creator of CREATORS) {
    const email = `${creator.username}@vyra.demo`;

    let user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = :email', { email });

    if (!user) {
      const publicId = ulid();
      const result = await execute(
        `INSERT INTO users (public_id, username, email, password_hash, account_category, account_type, status, email_verified_at)
         VALUES (:publicId, :username, :email, :passwordHash, 'individual', 'creator', 'active', NOW(3))`,
        { publicId, username: creator.username, email, passwordHash },
      );
      await execute(
        `INSERT INTO user_profiles (user_id, display_name, bio, avatar_url, follower_count)
         VALUES (:id, :name, :bio, :avatar, :followers)`,
        {
          id: result.insertId,
          name: creator.name,
          bio: `${creator.category} · demo account`,
          avatar: `https://i.pravatar.cc/300?u=${creator.username}`,
          followers: creator.followers,
        },
      );
      await execute('INSERT IGNORE INTO wallets (user_id) VALUES (:id)', { id: result.insertId });
      await execute(
        'INSERT IGNORE INTO referral_codes (user_id, code) VALUES (:id, :code)',
        { id: result.insertId, code: publicId.slice(-8).toUpperCase() },
      );
      user = { id: result.insertId };
      createdUsers += 1;
    }

    const category = await queryOne<{ id: number }>(
      'SELECT id FROM categories WHERE slug = :slug',
      { slug: creator.category },
    );

    const captions = CAPTIONS[creator.category] ?? ['A demo video'];
    for (const [index, caption] of captions.entries()) {
      const existing = await queryOne<{ id: number }>(
        'SELECT id FROM videos WHERE user_id = :userId AND caption = :caption',
        { userId: user.id, caption },
      );
      if (existing) continue;

      const publicId = ulid();
      // Marked complete so the feed will serve them, but with no poster key:
      // there is genuinely no media behind these rows. Pointing at a storage
      // path that does not exist would give the client a broken image and make
      // storage look wired up when it is not. A null key lets the client show
      // its own placeholder, which is the honest representation.
      await execute(
        `INSERT INTO videos
           (public_id, user_id, category_id, caption, duration_sec, privacy, status,
            processing_status, published_at, distribution_level,
            view_count, like_count, comment_count, share_count)
         VALUES (:publicId, :userId, :categoryId, :caption, :duration, 'public', 'published',
                 'complete', (NOW(3) - INTERVAL :hours HOUR), 3,
                 :views, :likes, :comments, :shares)`,
        {
          publicId,
          userId: user.id,
          categoryId: category?.id ?? null,
          caption,
          duration: 15 + index * 7,
          hours: index * 6 + 1,
          views: 1000 + index * 4300,
          likes: 80 + index * 220,
          comments: 4 + index * 17,
          shares: 2 + index * 9,
        },
      );
      createdVideos += 1;
    }
  }

  const newChats = await seedChats();
  console.log(`  ${newChats} demo conversation(s) created`);
  const newCommunity = await seedCommunity();
  console.log(`  ${newCommunity ? 1 : 0} community created`);

  const taggedLinks = await seedHashtags();
  console.log(`  ${taggedLinks} hashtag link(s) on demo videos`);

  const createdFollows = await seedFollowGraph();
  await recountDemoProfiles();
  console.log(`  ${createdFollows} follow edge(s) in the demo graph`);

  const createdTracks = await seedMusic();
  console.log(`  ${createdTracks} music track(s) created`);

  const totals = await query<{ users: number; videos: number }>(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE email LIKE '%@vyra.demo') AS users,
       (SELECT COUNT(*) FROM videos v JOIN users u ON u.id = v.user_id
         WHERE u.email LIKE '%@vyra.demo') AS videos`,
  );

  console.log(`  ${createdUsers} creator(s) created, ${createdVideos} video(s) created`);
  console.log(`  ${totals[0]?.users ?? 0} demo creators and ${totals[0]?.videos ?? 0} demo videos in total\n`);
  console.log('  Sign in with any of these:');
  for (const creator of CREATORS) {
    console.log(`    ${creator.username}@vyra.demo  /  ${PASSWORD}`);
  }
  console.log('');
}

main()
  .then(async () => {
    await pool.end();
    await redis.quit().catch(() => undefined);
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('\n  Seeding failed:', err instanceof Error ? err.message : err, '\n');
    await pool.end().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(1);
  });
