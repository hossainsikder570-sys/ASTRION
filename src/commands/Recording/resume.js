import { SlashCommandBuilder } from 'discord.js';
import { resumeRecording } from '../../services/recording/recordingManager.js';
import { runEphemeralCommand } from '../../services/recording/commandHelpers.js';

export default {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume the paused voice recording'),
  async execute(interaction) {
    return runEphemeralCommand(interaction, async () => {
      const id = await resumeRecording(interaction.guildId, interaction.user.id, interaction.memberPermissions);
      return `Recording ${id} has resumed for consenting participants.`;
    });
  },
};
