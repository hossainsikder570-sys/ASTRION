import { SlashCommandBuilder } from 'discord.js';
import { saveRecording } from '../../services/recording/recordingManager.js';
import { runEphemeralCommand } from '../../services/recording/commandHelpers.js';

export default {
  data: new SlashCommandBuilder().setName('save').setDescription('Finalize and save the active recording'),
  async execute(interaction) {
    return runEphemeralCommand(interaction, async () => {
      const record = await saveRecording(interaction.guildId, interaction.user.id, interaction.memberPermissions);
      return `Recording ${record.id} is finalized. Local backup: ${record.backupStatus}. Delivery: ${record.deliveryStatus}.`;
    });
  },
};
