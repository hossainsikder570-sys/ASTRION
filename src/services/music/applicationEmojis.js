import { logger } from '../../utils/logger.js';

const emojiIntentTerms = Object.freeze({
  previous: ['previous', 'prev', 'back', 'rewind'],
  pause: ['pause'],
  resume: ['resume', 'play'],
  skip: ['skip', 'next', 'forward'],
  stop: ['stop'],
  loop: ['loop', 'repeat'],
  shuffle: ['shuffle', 'random'],
  queue: ['queue', 'list'],
  volume: ['volume', 'audio', 'speaker'],
});

const applicationEmojiCache = new WeakMap();

function normalizeEmojiName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapApplicationEmojis(collection) {
  const entries = [...collection.values()];
  const mapped = new Map();

  for (const [intent, terms] of Object.entries(emojiIntentTerms)) {
    const emoji = entries.find((entry) => {
      const name = normalizeEmojiName(entry.name);
      return terms.some((term) => name.includes(term));
    });
    if (emoji) {
      mapped.set(intent, {
        id: emoji.id,
        name: emoji.name,
        animated: emoji.animated,
      });
    }
  }

  return mapped;
}

export async function loadApplicationEmojis(client) {
  if (applicationEmojiCache.has(client)) {
    client.musicEmojis = await applicationEmojiCache.get(client);
    return client.musicEmojis;
  }

  const fetchPromise = (async () => {
    try {
      const emojis = await client.application.emojis.fetch();
      const mapped = mapApplicationEmojis(emojis);
      logger.info(`Loaded ${emojis.size} application emoji(s) for music controls.`);
      return mapped;
    } catch (error) {
      logger.warn('Application emojis are unavailable; music controls will use text labels.', {
        code: error?.code,
      });
      return new Map();
    }
  })();

  applicationEmojiCache.set(client, fetchPromise);
  client.musicEmojis = await fetchPromise;
  return client.musicEmojis;
}

export function getMusicEmoji(client, intent) {
  return client?.musicEmojis?.get(intent) || null;
}
