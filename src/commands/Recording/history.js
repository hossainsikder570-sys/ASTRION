import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { searchRecordings } from '../../services/recording/recordingManager.js';
import { isRecordingManager, runEphemeralCommand } from '../../services/recording/commandHelpers.js';

function formatBdt(timestamp) {
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))} BDT`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('Search recordings you own or recordings as a server manager')
    .addStringOption((option) => option.setName('id').setDescription('Recording ID or partial ID').setMaxLength(40))
    .addStringOption((option) => option.setName('date').setDescription('Bangladesh date in YYYY-MM-DD format').setMaxLength(10))
    .addStringOption((option) => option.setName('channel').setDescription('Voice channel name').setMaxLength(100)),
  async execute(interaction) {
    return runEphemeralCommand(interaction, async () => {
      if (!interaction.guildId) throw new Error('Recording history is available in a server only.');
      const date = interaction.options.getString('date');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Use YYYY-MM-DD for the date filter.');
      }
      const records = await searchRecordings(interaction.guildId, interaction.user.id, {
        id: interaction.options.getString('id'),
        date,
        channel: interaction.options.getString('channel'),
      }, isRecordingManager(interaction.memberPermissions));
      if (!records.length) return 'No recordings matched your search. You can view your own recordings; server recording managers can search all recordings.';
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Recording history')
        .setDescription(records.map((record) =>
          `**${record.id} — ${record.title}**\n${record.voiceChannelName} • ${formatBdt(record.startedAt)}\nDuration: ${Math.floor(record.durationMs / 60_000)}m • ${record.fileSize} bytes • ${record.speakerCount} identified speakers`,
        ).join('\n\n').slice(0, 4_000))
        .setFooter({ text: 'Search dates and timestamps use Asia/Dhaka (BDT).' });
      await interaction.editReply({ content: '', embeds: [embed] });
      return null;
    });
  },
};
