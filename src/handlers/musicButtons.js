import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../utils/errorHandler.js';
import { getGuildMusicData } from '../services/music/playerStore.js';
import {
  getPlayer,
  buildQueueReply,
  destroyPlayerSession,
  setLoopMode,
  applyPause,
  applyResume,
  playPreviousTrack,
} from '../services/music/musicActions.js';
import { refreshPlayerMessage } from '../services/music/playerHandler.js';
import { canControlMusic, VOICE_CHANNEL_DENIAL } from '../services/music/permissions.js';
import { MUSIC_BUTTON_IDS } from '../services/music/musicEmbeds.js';

const queuePaginationIds = [
  MUSIC_BUTTON_IDS.QUEUE_FIRST,
  MUSIC_BUTTON_IDS.QUEUE_PREV,
  MUSIC_BUTTON_IDS.QUEUE_NEXT,
  MUSIC_BUTTON_IDS.QUEUE_LAST,
];

function buildVolumeModal(volume) {
  const input = new TextInputBuilder()
    .setCustomId('volume')
    .setLabel('Volume from 0 to 100')
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(3)
    .setValue(String(volume))
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId('music_volume_modal')
    .setTitle('Set playback volume')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function handleMusicButton(interaction, client) {
  if (!interaction.guildId) {
    return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Music controls are available in a server only.' });
  }

  const player = getPlayer(client, interaction.guildId);
  const guildData = getGuildMusicData(interaction.guildId);
  const { customId } = interaction;

  if (customId === MUSIC_BUTTON_IDS.QUEUE) {
    if (!player?.current) {
      return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Nothing is playing right now.' });
    }
    if (!canControlMusic(interaction.member, player)) {
      return replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: VOICE_CHANNEL_DENIAL });
    }
    guildData.queuePages.set(interaction.user.id, 0);
    const payload = buildQueueReply(client, interaction.guildId, 0);
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }

  if (queuePaginationIds.includes(customId)) {
    if (!player?.current) {
      return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'Nothing is playing right now.' });
    }
    if (!canControlMusic(interaction.member, player)) {
      return replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: VOICE_CHANNEL_DENIAL });
    }

    await interaction.deferUpdate();
    const currentPage = guildData.queuePages.get(interaction.user.id) || 0;
    const { totalPages } = buildQueueReply(client, interaction.guildId, currentPage);
    let page = Math.min(currentPage, totalPages - 1);

    if (customId === MUSIC_BUTTON_IDS.QUEUE_FIRST) page = 0;
    if (customId === MUSIC_BUTTON_IDS.QUEUE_PREV) page = Math.max(0, page - 1);
    if (customId === MUSIC_BUTTON_IDS.QUEUE_NEXT) page = Math.min(totalPages - 1, page + 1);
    if (customId === MUSIC_BUTTON_IDS.QUEUE_LAST) page = totalPages - 1;

    guildData.queuePages.set(interaction.user.id, page);
    const updated = buildQueueReply(client, interaction.guildId, page);
    return interaction.editReply({ embeds: updated.embeds, components: updated.components });
  }

  if (!player) {
    return replyUserError(interaction, { type: ErrorTypes.USER_INPUT, message: 'No music player is connected.' });
  }
  if (!canControlMusic(interaction.member, player)) {
    return replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: VOICE_CHANNEL_DENIAL });
  }

  if (customId === MUSIC_BUTTON_IDS.VOLUME) {
    return interaction.showModal(buildVolumeModal(guildData.volume));
  }

  await interaction.deferUpdate();

  switch (customId) {
    case MUSIC_BUTTON_IDS.PREVIOUS:
      await playPreviousTrack(client, interaction);
      break;
    case MUSIC_BUTTON_IDS.PAUSE:
      await applyPause(client, interaction.guildId);
      break;
    case MUSIC_BUTTON_IDS.RESUME:
      await applyResume(client, interaction.guildId);
      break;
    case MUSIC_BUTTON_IDS.SKIP:
      if (player.loop === 'track') player.setLoop('none');
      player.stop();
      break;
    case MUSIC_BUTTON_IDS.STOP:
      await destroyPlayerSession(client, interaction.guildId, player, guildData, { forceDisconnect: true });
      break;
    case MUSIC_BUTTON_IDS.SHUFFLE:
      if (player.queue.length > 0) {
        player.queue.shuffle();
        guildData.shuffle = !guildData.shuffle;
        await refreshPlayerMessage(client, interaction.guildId);
      }
      break;
    case MUSIC_BUTTON_IDS.LOOP: {
      const next = guildData.loop === 'none' ? 'track' : guildData.loop === 'track' ? 'queue' : 'none';
      await setLoopMode(client, interaction, next);
      break;
    }
    case MUSIC_BUTTON_IDS.VOL_DOWN:
    case MUSIC_BUTTON_IDS.VOL_UP: {
      const delta = customId === MUSIC_BUTTON_IDS.VOL_DOWN ? -10 : 10;
      guildData.volume = Math.max(0, Math.min(100, guildData.volume + delta));
      player.setVolume(guildData.volume);
      await refreshPlayerMessage(client, interaction.guildId);
      break;
    }
    default:
      break;
  }
}

export const musicButtonHandler = {
  async execute(interaction, client) {
    try {
      if (!client.riffy) {
        return replyUserError(interaction, {
          type: ErrorTypes.CONFIGURATION,
          message: 'Music is unavailable until Lavalink is configured.',
        });
      }
      await handleMusicButton(interaction, client);
    } catch (error) {
      logger.error('Music button action failed.', { name: error?.name, code: error?.code });
      await handleInteractionError(interaction, error, { type: 'button' });
    }
  },
};

export default musicButtonHandler;
