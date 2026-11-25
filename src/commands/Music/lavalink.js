import { ActionRowBuilder, ModalBuilder, PermissionsBitField, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import lavalinkConfig from '../../config/music/lavalink.js';

export default {
  category: 'Music',
  data: new SlashCommandBuilder()
    .setName('lavalink')
    .setDescription('Configure the Lavalink music server')
    .addSubcommand((subcommand) => subcommand.setName('edit').setDescription('Privately update Lavalink connection settings')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) &&
        !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: 'Manage Server permission is required to change Lavalink settings.', ephemeral: true });
    }
    const currentNode = lavalinkConfig.nodes[0];
    const modal = new ModalBuilder()
      .setCustomId('lavalink_edit_settings')
      .setTitle('Edit Lavalink server');
    const input = (customId, label, value, style = TextInputStyle.Short, required = true) =>
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setStyle(style)
        .setRequired(required)
        .setMaxLength(customId === 'password' ? 256 : 255)
        .setValue(value || ''));

    modal.addComponents(
      input('host', 'Host (hostname or IP)', currentNode?.host),
      input('port', 'Port (1–65535)', currentNode?.port ? String(currentNode.port) : ''),
      input('password', 'Password (leave blank to keep current)', '', TextInputStyle.Short, false),
      input('secure', 'Secure connection? (true or false)', currentNode ? String(currentNode.secure) : 'false'),
    );
    await interaction.showModal(modal);
  },
};
