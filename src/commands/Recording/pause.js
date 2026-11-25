import { SlashCommandBuilder } from 'discord.js';
import { pauseRecording } from '../../services/recording/recordingManager.js';
import { runEphemeralCommand } from '../../services/recording/commandHelpers.js';

export default {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the active voice recording'),
  async execute(interaction) {
    return runEphemeralCommand(interaction, async () => {
      const id = await pauseRecording(interaction.guildId, interaction.user.id, interaction.memberPermissions);
      return `Recording ${id} is paused. No audio is being captured.`;
    });
  },
};
