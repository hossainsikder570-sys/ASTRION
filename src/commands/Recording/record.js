import { SlashCommandBuilder } from 'discord.js';
import { startRecording } from '../../services/recording/recordingManager.js';
import { runEphemeralCommand } from '../../services/recording/commandHelpers.js';

export default {
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('Request participant consent and start a voice recording')
    .addStringOption((option) => option
      .setName('title')
      .setDescription('Optional title for the recording')
      .setMaxLength(100)
      .setRequired(false)),
  async execute(interaction, _config, client) {
    return runEphemeralCommand(interaction, async () => {
      const result = await startRecording(client, interaction, interaction.options.getString('title'));
      return `Recording ${result.recordingId} is awaiting participant consent. No audio is captured yet. Participants have ${result.consentWindowSeconds} seconds to respond.`;
    });
  },
};
