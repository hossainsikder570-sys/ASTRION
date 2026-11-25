import { createRequire } from 'node:module';
import { GatewayDispatchEvents } from 'discord.js';
import { logger } from '../../utils/logger.js';
import lavalinkConfig from '../../config/music/lavalink.js';
import { setupPlayerHandler } from './playerHandler.js';

const { Riffy } = createRequire(import.meta.url)('riffy');

export function initializeMusic(client) {
  client.riffy = null;

  if (!lavalinkConfig.nodes.length) {
    logger.warn(`Lavalink is not configured. ${lavalinkConfig.configurationError} Playback is unavailable until valid settings are supplied.`);
    return false;
  }

  try {
    client.riffy = new Riffy(client, lavalinkConfig.nodes, {
      send: (payload) => {
        const guildId = payload.d?.guild_id;
        if (!guildId) return;

        const guild = client.guilds.cache.get(guildId);
        if (guild?.shard) {
          guild.shard.send(payload);
          return;
        }

        const shardCount = client.ws.shards.size || 1;
        const shardId = Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
        client.ws.shards.get(shardId)?.send(payload);
      },
      defaultSearchPlatform: lavalinkConfig.defaultSearchPlatform,
      restVersion: lavalinkConfig.restVersion,
      bypassChecks: { nodeFetchInfo: true },
    });

    setupPlayerHandler(client);
    client.on('raw', (packet) => {
      if (![GatewayDispatchEvents.VoiceStateUpdate, GatewayDispatchEvents.VoiceServerUpdate].includes(packet.t)) return;
      client.riffy?.updateVoiceState(packet);
    });

    client.riffy.on('playerError', (player, error) => {
      logger.error('Lavalink playback error.', { guildId: player?.guildId, code: error?.code, name: error?.name });
    });

    logger.info('Lavalink client configured; waiting for a node connection.');
    return true;
  } catch (error) {
    client.riffy = null;
    logger.error('Could not initialize the Lavalink client.', { name: error?.name, code: error?.code });
    return false;
  }
}

export async function initRiffyAfterReady(client) {
  if (!client.riffy || !client.user?.id) return false;
  try {
    await client.riffy.init(client.user.id);
    return true;
  } catch (error) {
    logger.error('Lavalink connection initialization failed.', { name: error?.name, code: error?.code });
    return false;
  }
}
