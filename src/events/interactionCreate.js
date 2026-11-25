import { Events, MessageFlags } from 'discord.js';
import { getPlayer, setVolume } from '../services/music/musicActions.js';
import { canControlMusic } from '../services/music/permissions.js';
import { handleInteractionError, replyUserError, ErrorTypes } from '../utils/errorHandler.js';
import { replyMusicSuccess } from '../services/music/musicActions.js';
import { handleRecordingConsent, handleRecordingControl } from '../services/recording/recordingManager.js';

async function handleVolumeModal(interaction, client) {
  const player = getPlayer(client, interaction.guildId);
  if (!player) {
    return replyUserError(interaction, {
      type: ErrorTypes.USER_INPUT,
      message: 'There is no active music player.',
    });
  }
  if (!canControlMusic(interaction.member, player)) {
    return replyUserError(interaction, {
      type: ErrorTypes.PERMISSION,
      message: 'Join the same voice channel as the bot to change playback volume.',
    });
  }

  const rawVolume = interaction.fields.getTextInputValue('volume').trim();
  if (!/^\d{1,3}$/.test(rawVolume) || Number(rawVolume) > 100) {
    return replyUserError(interaction, {
      type: ErrorTypes.VALIDATION,
      message: 'Enter a whole-number volume from 0 to 100.',
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const embed = await setVolume(client, interaction, Number(rawVolume));
  await replyMusicSuccess(interaction, embed);
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guildId) {
        return replyUserError(interaction, {
          type: ErrorTypes.USER_INPUT,
          message: 'Music commands are available in a server only.',
        });
      }
      const command = client.commands.get(interaction.commandName);
      if (!command) {
        return replyUserError(interaction, {
          type: ErrorTypes.CONFIGURATION,
          message: 'That music command is unavailable.',
        });
      }
      try {
        await command.execute(interaction, null, client);
      } catch (error) {
        await handleInteractionError(interaction, error, { type: 'command' });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('rec_consent:')) {
        try {
          await handleRecordingConsent(interaction);
        } catch (error) {
          await handleInteractionError(interaction, error, { type: 'recording-consent' });
        }
        return;
      }
      if (interaction.customId.startsWith('rec_delete:')) {
        try {
          await handleRecordingControl(interaction);
        } catch (error) {
          await handleInteractionError(interaction, error, { type: 'recording-delete' });
        }
        return;
      }
      const button = client.buttons.get(interaction.customId);
      if (!button) return;
      try {
        await button.execute(interaction, client);
      } catch (error) {
        await handleInteractionError(interaction, error, { type: 'button' });
      }
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'music_volume_modal') {
      try {
        await handleVolumeModal(interaction, client);
      } catch (error) {
        await handleInteractionError(interaction, error, { type: 'modal' });
      }
    }
  },
};
