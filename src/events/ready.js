import { ActivityType, Events } from 'discord.js';
import { initRiffyAfterReady } from '../services/music/riffySetup.js';
import { loadApplicationEmojis } from '../services/music/applicationEmojis.js';
import { logger, startupLog } from '../utils/logger.js';
import { initializeRecordings } from '../services/recording/recordingManager.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      client.user.setPresence({
        status: 'online',
        activities: [{ name: 'the music queue', type: ActivityType.Listening }],
      });
      await loadApplicationEmojis(client);
      await initializeRecordings(client);
      initRiffyAfterReady(client);
      startupLog(`Ready as ${client.user.tag}; serving ${client.guilds.cache.size} server(s).`);
    } catch (error) {
      logger.error('Discord ready initialization failed.', { name: error?.name, code: error?.code });
    }
  },
};
