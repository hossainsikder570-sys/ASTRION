import { ActionRowBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import lavalinkConfig from '../../config/music/lavalink.js';

const STATUS_ORANGE = 0xf28c28;

function isBotOwner(userId) {
  return Boolean(process.env.BOT_OWNER_ID && userId === process.env.BOT_OWNER_ID.trim());
}

async function getLavalinkInfo() {
  const node = lavalinkConfig.nodes[0];
  if (!node) return null;

  const hostname = node.host.includes(':') && !node.host.startsWith('[') ? `[${node.host}]` : node.host;
  const endpoint = `${node.secure ? 'https' : 'http'}://${hostname}:${node.port}/v4/info`;
  try {
    const response = await fetch(endpoint, {
      headers: { Authorization: node.password },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function buildStatusEmbed(client) {
  const node = client.riffy?.nodeMap?.values?.().next?.().value;
  const connectedNodes = [...(client.riffy?.nodeMap?.values?.() || [])].filter((item) => item.connected);
  const activePlayers = [...(client.riffy?.players?.values?.() || [])];
  const info = await getLavalinkInfo();
  const sourceManagers = info?.sourceManagers || [];
  const plugins = (info?.plugins || []).map((plugin) => plugin.name);
  const sourceStatus = (name) => sourceManagers.some((source) => source.toLowerCase() === name.toLowerCase());
  const spotifyPlugin = plugins.find((plugin) => plugin.toLowerCase().includes('spotify'));
  const youtubePlugin = plugins.find((plugin) => plugin.toLowerCase().includes('youtube'));
  const nodeStats = node?.stats;
  const uptime = nodeStats?.uptime;
  const memory = nodeStats?.memory;
  const fields = [
    { name: 'Server', value: node ? `\`${node.host}:${node.port}\` · ${node.secure ? 'TLS' : 'Plain TCP'}` : 'Not configured', inline: true },
    { name: 'Node connection', value: connectedNodes.length ? `Online · ${connectedNodes.length} connected` : 'Offline / unreachable', inline: true },
    { name: 'Password', value: node?.password ? 'Configured · hidden' : 'Not configured', inline: true },
    { name: 'Ping', value: Number.isFinite(nodeStats?.ping) ? `${nodeStats.ping} ms` : 'Unavailable', inline: true },
    { name: 'Players', value: `${activePlayers.length} connected · ${activePlayers.filter((player) => player.playing).length} playing`, inline: true },
    { name: 'Lavalink version', value: info?.version?.semver || 'Unavailable', inline: true },
    { name: 'YouTube', value: youtubePlugin || (sourceStatus('youtube') ? 'Enabled' : info ? 'Not enabled (plugin/source missing)' : 'Could not verify'), inline: true },
    { name: 'Spotify', value: spotifyPlugin || (sourceStatus('spotify') ? 'Enabled' : info ? 'Not enabled (plugin/source missing)' : 'Could not verify'), inline: true },
    { name: 'Source managers', value: sourceManagers.length ? sourceManagers.join(', ').slice(0, 900) : 'Could not verify', inline: false },
    { name: 'Plugins', value: plugins.length ? plugins.join(', ').slice(0, 900) : 'None detected / could not verify', inline: false },
  ];
  if (Number.isFinite(uptime)) fields.push({ name: 'Node uptime', value: `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`, inline: true });
  if (memory?.used && memory?.reservable) fields.push({ name: 'Memory', value: `${(memory.used / 1024 / 1024).toFixed(0)} / ${(memory.reservable / 1024 / 1024).toFixed(0)} MB`, inline: true });

  return createEmbed({
    title: 'Lavalink Status',
    description: lavalinkConfig.configurationError || (info ? 'Live node diagnostics · password is never displayed.' : 'Node API did not respond. Check host, port, password, TLS, firewall, and Lavalink availability.'),
    color: STATUS_ORANGE,
    fields,
  });
}

export default {
  category: 'Music',
  data: new SlashCommandBuilder()
    .setName('lavalink')
    .setDescription('View Lavalink status or configure its server (bot owner only)')
    .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Show node, source, ping, and player diagnostics'))
    .addSubcommand((subcommand) => subcommand.setName('edit').setDescription('Privately update Lavalink connection settings')),

  async execute(interaction, _config, client) {
    if (!isBotOwner(interaction.user.id)) {
      return interaction.reply({ content: 'Only the configured bot owner can view or change Lavalink settings.', ephemeral: true });
    }
    if (interaction.options.getSubcommand() === 'status') {
      await interaction.deferReply({ ephemeral: true });
      return interaction.editReply({ embeds: [await buildStatusEmbed(client)] });
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
