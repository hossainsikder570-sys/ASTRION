import { SlashCommandBuilder } from 'discord.js';
import { discardRecording } from '../../services/recording/recordingManager.js';
import { runEphemeralCommand } from '../../services/recording/commandHelpers.js';

export default {
  data: new SlashCommandBuilder().setName('cancel').setDescription('Cancel and discard the active recording'),
  async execute(interaction) {
    return runEphemeralCommand(interaction, async () => {
      const id = await discardRecording(interaction.guildId, interaction.user.id, interaction.memberPermissions);
      return `Recording ${id} was cancelled and its temporary audio was discarded.`;
    });
  },
};
