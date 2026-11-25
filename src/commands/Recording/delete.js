import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { requestRecordingDeletion } from '../../services/recording/recordingManager.js';

export default {
  data: new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete a completed recording (server managers only)')
    .addStringOption((option) => option.setName('id').setDescription('Recording ID').setRequired(true).setMaxLength(40)),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await requestRecordingDeletion(interaction, interaction.options.getString('id'));
    } catch (error) {
      await interaction.editReply({ content: error?.message || 'Could not prepare recording deletion.' });
    }
  },
};
