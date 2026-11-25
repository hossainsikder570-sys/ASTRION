import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';

const ORANGE = 0xf28c28;

function describeCommand(command) {
  const json = command.data.toJSON();
  const options = json.options || [];
  if (!options.length) return `\`/${json.name}\` — ${json.description}`;

  const lines = options.map((option) => {
    if (option.type === 1) {
      return `\`/${json.name} ${option.name}\` — ${option.description}`;
    }
    if (option.type === 2) {
      return (option.options || []).map((subcommand) =>
        `\`/${json.name} ${option.name} ${subcommand.name}\` — ${subcommand.description}`,
      ).join('\n');
    }
    return `\`/${json.name}\` — ${json.description}`;
  }).filter(Boolean);

  return [...new Set(lines)].join('\n');
}

export default {
  category: 'General',
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show every bot command and setup instructions'),

  async execute(interaction, _config, client) {
    const grouped = new Map();
    for (const command of client.commands.values()) {
      const category = command.category || 'Other';
      grouped.set(category, [...(grouped.get(category) || []), describeCommand(command)]);
    }

    const fields = [];
    for (const [category, commands] of grouped) {
      const chunks = [];
      let current = '';
      for (const commandText of commands) {
        const next = current ? `${current}\n${commandText}` : commandText;
        if (next.length > 1000 && current) {
          chunks.push(current);
          current = commandText;
        } else {
          current = next;
        }
      }
      if (current) chunks.push(current);
      chunks.forEach((value, index) => fields.push({
        name: chunks.length > 1 ? `${category} (${index + 1}/${chunks.length})` : category,
        value,
        inline: false,
      }));
    }
    fields.push({
      name: 'Music setup',
      value: [
        '1. Run a reachable Lavalink v4 node and configure its host, port, password, and TLS setting with `/lavalink edit` (bot owner only).',
        '2. Give the bot **Connect**, **Speak**, and **View Channel** in the voice channel; run `/join` or `/play` while you are connected to voice.',
        '3. Run `/lavalink status` to inspect node connectivity, latency, active players, source managers, and plugins.',
        '4. YouTube and Spotify require compatible Lavalink source managers/plugins on the Lavalink server. Spotify playback support depends on a Spotify plugin; a Spotify URL is not itself an audio stream.',
        '5. Set `BOT_OWNER_ID` to the bot owner Discord user ID before using either Lavalink subcommand. Passwords are never shown in status.',
      ].join('\n').slice(0, 1024),
      inline: false,
    });

    const embed = createEmbed({
      title: 'ASTRION Command Guide',
      description: 'All currently registered slash commands, followed by setup and troubleshooting notes.',
      color: ORANGE,
      fields: fields.slice(0, 25),
    });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
