import { logger } from '../../utils/logger.js';

const emojiIntentTerms = Object.freeze({
  previous: ['previous', 'prev', 'back', 'rewind', 'music'],
  pause: ['pause'],
  resume: ['resume', 'play', 'unmute'],
  skip: ['skip', 'next', 'forward'],
  stop: ['stop', 'clear', 'bin'],
  loop: ['loop', 'repeat'],
  shuffle: ['shuffle', 'random', 'automode'],
  queue: ['queue', 'list', 'music'],
  volume: ['volume', 'audio', 'speaker'],
});

const applicationEmojiCache = new WeakMap();

function normalizeEmojiName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapApplicationEmojis(collection) {
  const entries = [...collection.values()];
  const mapped = new Map();

  for (const [index, [intent, terms]] of Object.entries(emojiIntentTerms).entries()) {
    const emoji = entries.find((entry) => {
      const name = normalizeEmojiName(entry.name);
      return terms.some((term) => name.includes(term));
    }) || entries[index % Math.max(entries.length, 1)];
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
      client.musicApplicationEmojiList = [...emojis.values()].map((emoji) => ({
        id: emoji.id,
        name: emoji.name,
        animated: emoji.animated,
      }));
      logger.info(`Loaded ${emojis.size} application emoji(s) for music controls.`, {
        names: client.musicApplicationEmojiList.map((emoji) => emoji.name),
      });
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
